#!/usr/bin/env python3
import json
import sys
import subprocess
import os
import random
import time
import argparse
import shutil
import glob

COMFY_CMD = "/Users/yinglin/.comfy-env/bin/comfy"
OUTPUT_DIR = "/Users/yinglin/ComfyUI-Shared/output"

def main():
    parser = argparse.ArgumentParser(description="AURA Film Asset Generator")
    parser.add_argument("--type", required=True, choices=["front_cabin", "rear_cabin", "hero_cabin", "diagnostic"])
    parser.add_argument("--prompt_file", required=True)
    parser.add_argument("--count", type=int, default=1)
    parser.add_argument("--width", type=int, default=1536)
    parser.add_argument("--height", type=int, default=864)
    args = parser.parse_args()

    with open(args.prompt_file, 'r') as f:
        prompt_text = f.read().strip()

    wf_path = "film_assets/workflows/image_qwen_image_2_1_t2i_patched.json"
    
    for i in range(args.count):
        seed = random.randint(0, 1000000000)
        prefix = f"AURA_{args.type}_{seed}"
        temp_wf = f"film_assets/candidates/{args.type}/temp_wf_{seed}.json"

        shutil.copy(wf_path, temp_wf)
        # Apply slot overrides in-place
        subprocess.run([
            COMFY_CMD, "workflow", "set-slot", temp_wf,
            f"459.prompt={prompt_text}",
            f"459.seed={seed}",
            f"459.width={args.width}",
            f"459.height={args.height}",
            f"459.switch=true",
            f"461.filename_prefix={prefix}"
        ], check=True)

        print(f"Generating {args.type} {i+1}/{args.count} with seed {seed}...")
        
        # Run workflow
        subprocess.run([
            COMFY_CMD, "run", "--workflow", temp_wf, "--timeout", "1200", "--wait"
        ], check=True)
        
        # Find and move output
        generated_files = glob.glob(os.path.join(OUTPUT_DIR, f"{prefix}_*.png"))
        if not generated_files:
            generated_files = glob.glob(os.path.join(OUTPUT_DIR, f"{prefix}.png"))
            if not generated_files:
                generated_files = glob.glob(os.path.join(OUTPUT_DIR, f"{prefix}*.png"))

        for file_path in generated_files:
            filename = os.path.basename(file_path)
            dest = f"film_assets/candidates/{args.type}/{filename}"
            shutil.copy(file_path, dest)
            print(f"Saved {dest}")
            
        # Save metadata
        meta_path = f"film_assets/candidates/{args.type}/{prefix}_meta.json"
        with open(meta_path, 'w') as f:
            json.dump({
                "type": args.type,
                "prompt": prompt_text,
                "seed": seed,
                "width": args.width,
                "height": args.height,
                "model": "qwen_image_2.1_int8_convrot.safetensors",
                "workflow": temp_wf
            }, f, indent=2)

if __name__ == "__main__":
    main()
