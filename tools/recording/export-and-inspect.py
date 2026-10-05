"""Export live-recorded WebM streams; inspect every encoded Center video frame."""
from pathlib import Path
import subprocess,json,sys,csv,hashlib
root=Path(sys.argv[1]);e=json.loads((root/'capture-evidence.json').read_text());start=e['controllerStartEpochMs']
roles=e['roles'];report={'revision':e['revision'],'recordingOriginUtcMs':start,'durationSeconds':e['clipDurationSeconds'],'streams':{}}
names={'cluster-main':'cluster','center-main':'center','front-passenger-main':'passenger','rear-tablet':'rear','window-tablet':'window','control':'scenario-control'}
def probe(p):
 return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(p)]))
def frames(p,filters,pixfmt):
 return subprocess.check_output(['ffmpeg','-v','error','-i',str(p),'-vf',filters,'-fps_mode','passthrough','-f','rawvideo','-pix_fmt',pixfmt,'pipe:1'])
for role in roles:
 p=root/'raw'/(role+'.webm');meta=probe(p);v=next(s for s in meta['streams'] if s['codec_type']=='video')
 assert (v['width'],v['height'])==(1920,1080)
 num,den=map(int,v['avg_frame_rate'].split('/'));fps=num/den
 raw=frames(p,'scale=16:9','gray');means=[sum(raw[i:i+144])/144 for i in range(0,len(raw),144)]
 flashes=[i for i in range(1,min(len(means),int(fps*12))) if means[i]>245 and means[i-1]<10]
 if not flashes:raise RuntimeError('Missing pre-roll synchronization marker: '+role)
 marker_pts=flashes[0]/fps
 trim=marker_pts+(start-e['calibrationWhitePaintEpochMs'][role])/1000
 target=root/(names[role]+'-complete.mp4')
 subprocess.run(['ffmpeg','-v','error','-y','-ss',f'{trim:.6f}','-i',str(p),'-t',str(e['clipDurationSeconds']),'-an','-c:v','libx264','-preset','fast','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',str(target)],check=True)
 report['streams'][role]={'file':str(target.resolve()),'fps':fps,'width':1920,'height':1080,'calibrationWhiteVideoPtsSeconds':marker_pts,'sourceTrimSeconds':trim,'durationSeconds':float(probe(target)['format']['duration']),'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'timeAlignmentUncertaintySeconds':2/fps,'alignmentEstimateNotGuarantee':True}
 print('EXPORTED',target,fps,flush=True)
# The frozen ACCEPT button is orange above the persistent orange bottom action row.
transitions=e['observations']['center-main']['transitions']
visible=[t for t in transitions if t.get('consent') and 'acceptBounds' in t]
if not visible:raise RuntimeError('No consent geometry to inspect')
b=visible[0]['acceptBounds'];x=int(b['x']+b['width']*.2);y=int(b['y']+b['height']*.2);w=int(b['width']*.6);h=int(b['height']*.6)
p=root/'center-complete.mp4';fps=report['streams']['center-main']['fps'];raw=frames(p,f'crop={w}:{h}:{x}:{y},scale=16:8','rgb24');size=16*8*3
rows=[];ranges=[];active=None
for index in range(len(raw)//size):
 f=raw[index*size:(index+1)*size];orange=sum(1 for i in range(0,len(f),3) if f[i]>180 and 35<f[i+1]<170 and f[i+2]<90)/128
 is_visible=orange>.6;rows.append({'frame':index,'time_seconds':index/fps,'accept_orange_fraction':round(orange,5),'consent_visible':is_visible})
 if is_visible and active is None:active=index
 if not is_visible and active is not None:ranges.append({'first_frame':active,'last_frame':index-1,'start_seconds':active/fps,'end_seconds':index/fps});active=None
if active is not None:ranges.append({'first_frame':active,'last_frame':len(rows)-1,'start_seconds':active/fps,'end_seconds':len(rows)/fps})
with (root/'center-frame-consent.csv').open('w') as f:
 wr=csv.DictWriter(f,fieldnames=list(rows[0]));wr.writeheader();wr.writerows(rows)
high=next(t for t in e['trace'] if t['action']=='high');normal=next(t for t in e['trace'] if t['action']=='normal');accepted=next(t for t in e['trace'] if t['action']=='accept')
focus_start=next(t['epochMs'] for t in transitions if 'load-reduced' in (t.get('loadClass') or ''))
normal_paint=next(t['epochMs'] for t in transitions if t['epochMs']>focus_start and 'load-reduced' not in (t.get('loadClass') or ''))
report['centerFrameInspection']={'method':'Every encoded frame of the actual continuous recording; color classifier inside frozen ACCEPT button bounds','roi':[x,y,w,h],'framesInspected':len(rows),'consentRanges':ranges,'prematureConsentRanges':[r for r in ranges if r['start_seconds']<(normal_paint-start)/1000-2/fps], 'normalPresentationPaintSeconds':(normal_paint-start)/1000,'noEarlyConsentDom':not any(t.get('consent') for t in transitions if start<=t['epochMs']<normal_paint),'highObservedSeconds':high['elapsedMs']/1000,'normalAskObservedSeconds':normal['elapsedMs']/1000,'acceptObservedSeconds':accepted['elapsedMs']/1000,'domPaintTransitions':[{**t,'time_seconds':(t['epochMs']-start)/1000} for t in transitions if t['epochMs']>=start]}
(root/'video-verification.json').write_text(json.dumps(report,indent=2))
with (root/'event-timetable.csv').open('w') as f:
 wr=csv.writer(f);wr.writerow(['action','time_seconds','utc','proposal_status','decision','reason_code','trace_id','journey_added','rear_mode','cloud_intelligence'])
 for t in e['trace']:
  s=t['observed'];wr.writerow([t['action'],t['elapsedMs']/1000,t['timestamp'],s.get('proposal'),s.get('decision'),s.get('reasonCode'),s.get('traceId'),s['added'],s['rearMode'],s['intelligence']])
print(json.dumps(report['centerFrameInspection'],indent=2))
