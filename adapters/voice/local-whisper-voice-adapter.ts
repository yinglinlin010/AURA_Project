import { spawn } from "node:child_process";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VoiceProvider, VoiceProviderEvent } from "../../packages/core-runtime/src/voice-runtime.js";

export interface VoiceProcessResult {
  stdout: Buffer;
  stderr: Buffer;
  exitCode: number;
}

export interface VoiceProcessRunner {
  run(command: string, args: readonly string[], options: { signal: AbortSignal; timeoutMs: number }): Promise<VoiceProcessResult>;
}

export interface LocalWhisperVoiceAdapterOptions {
  modelPath?: string;
  whisperCli?: string;
  sayCommand?: string;
  afconvertCommand?: string;
  sayVoice?: string;
  language?: string;
  platform?: NodeJS.Platform;
  runner?: VoiceProcessRunner;
  candidateForTranscript?: (text: string) => unknown;
  maxUtteranceBytes?: number;
  silenceMs?: number;
  silenceRmsThreshold?: number;
  processTimeoutMs?: number;
}

const PCM_MIME = "audio/pcm;rate=24000";
const INPUT_MIME = "audio/pcm;rate=16000";
const DEFAULT_MAX_UTTERANCE_BYTES = 960_000; // 30 seconds, 16 kHz, mono, signed 16-bit PCM.
const DEFAULT_SILENCE_MS = 700;
const DEFAULT_SILENCE_RMS = 320;
const DEFAULT_PROCESS_TIMEOUT_MS = 45_000;
const MAX_STDOUT_BYTES = 2_000_000;
const MAX_OUTPUT_WAV_BYTES = 12_000_000;

/** Local push-to-talk backend: whisper.cpp ASR plus macOS say/afconvert speech output. */
export class LocalWhisperVoiceAdapter implements VoiceProvider {
  readonly modelName = "local-whisper-cpp";
  readonly route = "local" as const;

  private readonly modelPath: string | undefined;
  private readonly whisperCli: string;
  private readonly sayCommand: string;
  private readonly afconvertCommand: string;
  private readonly sayVoice: string | undefined;
  private readonly language: string;
  private readonly platform: NodeJS.Platform;
  private readonly runner: VoiceProcessRunner;
  private readonly candidateForTranscript: ((text: string) => unknown) | undefined;
  private readonly maxUtteranceBytes: number;
  private readonly silenceMs: number;
  private readonly silenceRmsThreshold: number;
  private readonly processTimeoutMs: number;
  private readonly listeners = new Set<(event: VoiceProviderEvent) => void>();
  private connectedState = false;
  private closed = false;
  private traceId = "local-voice";
  private samples: Buffer[] = [];
  private bufferedBytes = 0;
  private silentDurationMs = 0;
  private speechStarted = false;
  private taskController: AbortController | undefined;
  private taskPromise: Promise<void> | undefined;
  private busy = false;
  private workDirectory: string | undefined;

  constructor(options: LocalWhisperVoiceAdapterOptions = {}) {
    this.modelPath = options.modelPath ?? process.env.AURA_WHISPER_MODEL;
    this.whisperCli = options.whisperCli ?? process.env.AURA_WHISPER_CLI ?? "whisper-cli";
    this.sayCommand = options.sayCommand ?? "say";
    this.afconvertCommand = options.afconvertCommand ?? "afconvert";
    this.sayVoice = options.sayVoice ?? process.env.AURA_SAY_VOICE;
    this.language = options.language ?? process.env.AURA_WHISPER_LANGUAGE ?? "auto";
    this.platform = options.platform ?? process.platform;
    this.runner = options.runner ?? new SpawnVoiceProcessRunner();
    this.candidateForTranscript = options.candidateForTranscript;
    this.maxUtteranceBytes = options.maxUtteranceBytes ?? DEFAULT_MAX_UTTERANCE_BYTES;
    this.silenceMs = options.silenceMs ?? DEFAULT_SILENCE_MS;
    this.silenceRmsThreshold = options.silenceRmsThreshold ?? DEFAULT_SILENCE_RMS;
    this.processTimeoutMs = options.processTimeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    if (!Number.isInteger(this.maxUtteranceBytes) || this.maxUtteranceBytes < 2 || this.maxUtteranceBytes % 2 !== 0) {
      throw new Error("INVALID_LOCAL_VOICE_MAX_UTTERANCE_BYTES");
    }
    if (!Number.isFinite(this.silenceMs) || this.silenceMs < 100 || this.silenceMs > 5_000) throw new Error("INVALID_LOCAL_VOICE_SILENCE_MS");
    if (!Number.isInteger(this.processTimeoutMs) || this.processTimeoutMs < 1 || this.processTimeoutMs > 120_000) throw new Error("INVALID_LOCAL_VOICE_TIMEOUT_MS");
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(this.language)) throw new Error("INVALID_LOCAL_VOICE_LANGUAGE");
    if (this.sayVoice !== undefined && (!this.sayVoice.trim() || this.sayVoice.length > 128)) throw new Error("INVALID_LOCAL_VOICE_SAY_VOICE");
  }

  get connected(): boolean { return this.connectedState && !this.closed; }

  subscribe(listener: (event: VoiceProviderEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async connect(traceId: string): Promise<void> {
    if (!this.modelPath?.trim()) throw new Error("LOCAL_VOICE_MODEL_REQUIRED");
    if (this.platform !== "darwin") throw new Error("LOCAL_VOICE_TTS_UNSUPPORTED_OS");
    try {
      await access(this.modelPath);
    } catch {
      throw new Error("LOCAL_VOICE_MODEL_NOT_READABLE");
    }
    this.traceId = traceId;
    this.closed = false;
    this.connectedState = true;
    this.clearInput();
  }

  sendAudioChunk(data: Buffer, mimeType = INPUT_MIME, traceId?: string): void {
    if (!this.connected) throw new Error("VOICE_SESSION_NOT_CONNECTED");
    if (traceId) this.traceId = traceId;
    if (mimeType !== INPUT_MIME || data.length === 0 || data.length % 2 !== 0) throw new Error("INVALID_LOCAL_VOICE_PCM");
    if (this.busy) return;
    if (this.bufferedBytes + data.length > this.maxUtteranceBytes) {
      this.clearInput();
      this.fail("LOCAL_VOICE_UTTERANCE_TOO_LARGE");
      return;
    }
    const copy = Buffer.from(data);
    this.samples.push(copy);
    this.bufferedBytes += copy.length;
    if (pcmRms(copy) >= this.silenceRmsThreshold) {
      this.speechStarted = true;
      this.silentDurationMs = 0;
    } else if (this.speechStarted) {
      this.silentDurationMs += copy.length / 32; // 16 kHz, mono, S16LE => 32 bytes/ms.
      if (this.silentDurationMs >= this.silenceMs) {
        const task = this.finishUtterance();
        this.taskPromise = task;
        void task.finally(() => { if (this.taskPromise === task) this.taskPromise = undefined; });
      }
    }
  }

  sendText(_text: string, _traceId?: string): void {
    throw new Error("LOCAL_VOICE_TEXT_INPUT_UNSUPPORTED");
  }

  async interrupt(_traceId: string, _reasonCode?: string): Promise<void> {
    this.connectedState = false;
    this.clearInput();
    this.taskController?.abort(new Error("VOICE_STOP_COMMAND"));
    await this.taskPromise?.catch(() => undefined);
    await this.removeWorkDirectory();
  }

  close(): void {
    this.closed = true;
    this.connectedState = false;
    this.clearInput();
    this.taskController?.abort(new Error("VOICE_RUNTIME_CLOSED"));
  }

  private async finishUtterance(): Promise<void> {
    if (this.busy || !this.connected || !this.speechStarted) return;
    const pcm = Buffer.concat(this.samples, this.bufferedBytes);
    this.clearInput();
    this.busy = true;
    const controller = new AbortController();
    this.taskController = controller;
    let directory: string | undefined;
    try {
      directory = await mkdtemp(join(tmpdir(), "aura-local-voice-"));
      this.workDirectory = directory;
      const inputPath = join(directory, "utterance.wav");
      await writeFile(inputPath, makeWav(pcm, 16_000));
      const asr = await this.runner.run(this.whisperCli, ["-m", this.modelPath!, "-f", inputPath, "-l", this.language, "-nt", "-np"], {
        signal: controller.signal,
        timeoutMs: this.processTimeoutMs,
      });
      assertSuccess(asr, "LOCAL_VOICE_ASR_FAILED");
      if (controller.signal.aborted || !this.connected) return;
      const transcript = asr.stdout.toString("utf8").trim().replace(/^\[[^\]]+\]\s*/gm, "").trim();
      if (!transcript) throw new Error("LOCAL_VOICE_EMPTY_TRANSCRIPT");
      this.emit({ type: "input_transcription", text: transcript, isFinal: true });
      const candidate = this.candidateForTranscript?.(transcript);
      if (candidate !== undefined) this.emit({ type: "proposal_candidate", candidate, traceId: this.traceId });
      const response = `I heard: ${transcript}`;
      this.emit({ type: "output_transcription", text: response });
      const aiffPath = join(directory, "response.aiff");
      const wavPath = join(directory, "response.wav");
      const sayArgs = [...(this.sayVoice === undefined ? [] : ["-v", this.sayVoice]), "-o", aiffPath, "--", response];
      const tts = await this.runner.run(this.sayCommand, sayArgs, {
        signal: controller.signal,
        timeoutMs: this.processTimeoutMs,
      });
      assertSuccess(tts, "LOCAL_VOICE_TTS_FAILED");
      const convert = await this.runner.run(this.afconvertCommand, ["-f", "WAVE", "-d", "LEI16@24000", "-c", "1", aiffPath, wavPath], {
        signal: controller.signal,
        timeoutMs: this.processTimeoutMs,
      });
      assertSuccess(convert, "LOCAL_VOICE_AUDIO_CONVERSION_FAILED");
      if (controller.signal.aborted || !this.connected) return;
      if ((await stat(wavPath)).size > MAX_OUTPUT_WAV_BYTES) throw new Error("LOCAL_VOICE_OUTPUT_TOO_LARGE");
      const outputWav = await readFile(wavPath);
      const outputPcm = extractWavPcm(outputWav);
      for (let offset = 0; offset < outputPcm.length; offset += 24_000) {
        if (controller.signal.aborted || !this.connected) return;
        this.emit({ type: "audio_chunk", data: outputPcm.subarray(offset, Math.min(offset + 24_000, outputPcm.length)), mimeType: PCM_MIME });
      }
      this.emit({ type: "turn_complete" });
    } catch (error) {
      if (!controller.signal.aborted && this.connected) this.fail(error instanceof Error ? error.message : "LOCAL_VOICE_FAILED");
    } finally {
      if (this.taskController === controller) this.taskController = undefined;
      this.busy = false;
      if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
      if (this.workDirectory === directory) this.workDirectory = undefined;
    }
  }

  private fail(reasonCode: string): void {
    this.connectedState = false;
    this.emit({ type: "provider_error", reasonCode: reasonCode.slice(0, 128).replace(/[^A-Z0-9_:.-]/gi, "_") });
  }

  private clearInput(): void {
    this.samples = [];
    this.bufferedBytes = 0;
    this.silentDurationMs = 0;
    this.speechStarted = false;
  }

  private async removeWorkDirectory(): Promise<void> {
    const directory = this.workDirectory;
    this.workDirectory = undefined;
    if (directory) await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }

  private emit(event: VoiceProviderEvent): void {
    for (const listener of this.listeners) {
      try { listener(event); } catch { /* An observer must not break audio processing. */ }
    }
  }
}

class SpawnVoiceProcessRunner implements VoiceProcessRunner {
  run(command: string, args: readonly string[], options: { signal: AbortSignal; timeoutMs: number }): Promise<VoiceProcessResult> {
    return new Promise((resolve, reject) => {
      if (options.signal.aborted) return reject(new Error("LOCAL_VOICE_CANCELLED"));
      const child = spawn(command, [...args], { shell: false, stdio: ["ignore", "pipe", "pipe"] });
      const stdout: Buffer[] = [];
      const stderr: Buffer[] = [];
      let outputBytes = 0;
      let settled = false;
      let terminationError: Error | undefined;
      const finish = (error?: Error, result?: VoiceProcessResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        options.signal.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(result!);
      };
      const terminate = (error: Error) => {
        if (terminationError) return;
        terminationError = error;
        child.kill("SIGTERM");
      };
      const abort = () => terminate(new Error("LOCAL_VOICE_CANCELLED"));
      const timeout = setTimeout(() => terminate(new Error("LOCAL_VOICE_PROCESS_TIMEOUT")), options.timeoutMs);
      options.signal.addEventListener("abort", abort, { once: true });
      child.stdout.on("data", (chunk: Buffer) => {
        outputBytes += chunk.length;
        if (outputBytes > MAX_STDOUT_BYTES) { terminate(new Error("LOCAL_VOICE_PROCESS_OUTPUT_TOO_LARGE")); return; }
        stdout.push(Buffer.from(chunk));
      });
      child.stderr.on("data", (chunk: Buffer) => {
        if (Buffer.concat(stderr).length < 64_000) stderr.push(Buffer.from(chunk).subarray(0, 64_000));
      });
      child.once("error", (error) => finish(new Error((error as NodeJS.ErrnoException).code === "ENOENT" ? "LOCAL_VOICE_EXECUTABLE_NOT_FOUND" : "LOCAL_VOICE_PROCESS_START_FAILED")));
      child.once("close", (exitCode) => {
        if (terminationError) finish(terminationError);
        else finish(undefined, { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), exitCode: exitCode ?? -1 });
      });
    });
  }
}

function assertSuccess(result: VoiceProcessResult, reason: string): void {
  if (result.exitCode !== 0) throw new Error(reason);
}

function pcmRms(data: Buffer): number {
  let squareSum = 0;
  const count = data.length / 2;
  for (let i = 0; i < data.length; i += 2) {
    const sample = data.readInt16LE(i);
    squareSum += sample * sample;
  }
  return Math.sqrt(squareSum / count);
}

function makeWav(pcm: Buffer, sampleRate: number): Buffer {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write("RIFF", 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write("WAVE", 8);
  wav.write("fmt ", 12); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24); wav.writeUInt32LE(sampleRate * 2, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34);
  wav.write("data", 36); wav.writeUInt32LE(pcm.length, 40); pcm.copy(wav, 44);
  return wav;
}

function extractWavPcm(wav: Buffer): Buffer {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") throw new Error("LOCAL_VOICE_INVALID_OUTPUT_WAV");
  let offset = 12;
  let validFormat = false;
  while (offset + 8 <= wav.length) {
    const chunkId = wav.toString("ascii", offset, offset + 4);
    const size = wav.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (start + size > wav.length) throw new Error("LOCAL_VOICE_INVALID_OUTPUT_WAV");
    if (chunkId === "fmt ") {
      if (size < 16) throw new Error("LOCAL_VOICE_INVALID_OUTPUT_WAV");
      validFormat = wav.readUInt16LE(start) === 1 && wav.readUInt16LE(start + 2) === 1 &&
        wav.readUInt32LE(start + 4) === 24_000 && wav.readUInt16LE(start + 14) === 16;
    }
    if (chunkId === "data") {
      if (!validFormat) throw new Error("LOCAL_VOICE_UNSUPPORTED_OUTPUT_PCM");
      return wav.subarray(start, start + size);
    }
    offset = start + size + (size % 2);
  }
  throw new Error("LOCAL_VOICE_OUTPUT_PCM_MISSING");
}

export const localVoiceInternals = { makeWav, extractWavPcm };
