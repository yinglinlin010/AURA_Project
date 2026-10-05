"""Audit actual recordings together with live DOM and Gateway evidence."""
from pathlib import Path
import json,sys,hashlib,subprocess,csv
root=Path(sys.argv[1]); takes=[]
ratios={'cluster-main':(1920,720),'center-main':(1920,1080),'front-passenger-main':(1920,1080),'rear-tablet':(1440,1080),'window-tablet':(1440,1080)}
for folder in sorted(root.glob('take[123]')):
 if not (folder/'video-verification.json').exists():continue
 e=json.loads((folder/'capture-evidence.json').read_text());v=json.loads((folder/'video-verification.json').read_text());t={x['action']:x for x in e['trace']};checks={}
 checks['nine_actual_observations']=len(e['trace'])==9
 checks['reset_normal']=t['reset']['observed']['reset']
 checks['no_journey_change_before_accept']=all(not t[x]['observed']['added'] for x in ['reset','request','high','normal']) and t['accept']['observed']['added']
 checks['high_defer']=t['high']['observed']['load']=='high' and t['request']['observed']['decision']=='DEFER'
 checks['normal_ask']=t['normal']['observed']['load']=='normal' and t['normal']['observed']['decision']=='ASK'
 checks['offline_local_journey']=t['offline']['observed']['cloud']=='offline' and t['offline']['observed']['added'] and t['offline']['observed']['intelligence']=='unavailable'
 checks['restore_remains_quiet_held']=t['restore']['observed']['cloud']=='online' and t['restore']['observed']['rearMode']=='quiet' and t['restore']['observed']['intelligence']=='available_but_held'
 checks['resume_restores']=t['resume']['observed']['rearMode']=='normal' and t['resume']['observed']['intelligence']=='presented'
 checks['no_browser_page_errors']=not e['errors']
 checks['no_early_consent_flash']=not v['centerFrameInspection']['prematureConsentRanges'] and v['centerFrameInspection'].get('noEarlyConsentDom',True)
 rolechecks={}
 for role,(width,height) in ratios.items():
  frames=e['observations'][role]['frames'];frames=[f for f in frames if f['epochMs']>=e['controllerStartEpochMs']]
  samples=[s['roles'][role] for s in e['samples']]
  geometry=[f['bounds'] for f in frames]
  inside=all(c['bounds']['width']==0 or c['display']=='none' or (c['bounds']['left']>=s['bounds']['left']-1 and c['bounds']['right']<=s['bounds']['right']+1 and c['bounds']['top']>=s['bounds']['top']-1 and c['bounds']['bottom']<=s['bounds']['bottom']+1) for s in samples for c in s.get('critical',[]))
  rolechecks[role]={'raf_frames_observed':len(frames),'stable_native_bounds':all(abs(b['width']-width)<.1 and abs(b['height']-height)<.1 for b in geometry),'no_document_overflow':all(not f['overflow'] for f in frames),'critical_elements_inside_display':inside,'no_consent_during_high_dom':all(not f['consent'] for f in frames if 'load-reduced' in (f.get('loadClass') or ''))}
  if role=='cluster-main':rolechecks[role]['four_tires_kept']=all(all(k in s['text'] for k in ['FL','FR','RL','RR','RPM','Power']) for s in samples)
  if role=='rear-tablet':rolechecks[role]['quiet_held_until_resume']=any(f.get('rearMode')=='quiet' and f.get('live')=='available_but_held' for f in frames)
 checks['all_role_geometry_checks']=all(all(value for key,value in rc.items() if isinstance(value,bool)) for rc in rolechecks.values())
 events=json.loads((folder/'gateway-events.json').read_text());checks['nonempty_gateway_evidence']=len(events)>0
 unique={x['message']['event']['eventId']:x['message']['event'] for x in events if x['role']=='control' and x['message'].get('kind')=='event' and x['message']['event']['occurredAt']>=e['controllerStartEpochMs']}
 consent_events=[x for x in unique.values() if x['type']=='proposal.consent.recorded']
 stop_events=[x for x in unique.values() if x['type']=='journey.stop.added']
 checks['high_confirmed_before_request']=t['high']['elapsedMs']<t['request']['elapsedMs'] and t['high']['observed'].get('proposal') is None
 normal_events=[x for x in unique.values() if x['type']=='driver.load.updated' and x['payload']['level']=='normal' and x['occurredAt']>e['controllerStartEpochMs']+1000]
 asks=[x for x in unique.values() if x['type']=='proposal.policy.decided' and x['payload']['decision']['outcome']=='ASK']
 checks['gateway_no_ask_before_normal']=bool(normal_events and asks) and min(x['sequence'] for x in normal_events)<min(x['sequence'] for x in asks)
 checks['gateway_consent_precedes_stop_mutation']=bool(consent_events and stop_events) and min(x['sequence'] for x in consent_events)<min(x['sequence'] for x in stop_events)
 nav=subprocess.check_output(['ffmpeg','-v','error','-i',v['streams']['center-main']['file'],'-vf','crop=20:20:585:1000,scale=8:8','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
 with (folder/'center-frame-consent.csv').open() as f:consent_rows=list(csv.DictReader(f))
 high_consent=[];joint=[]
 for i in range(len(nav)//192):
  pixels=nav[i*192:(i+1)*192];orange=sum(1 for j in range(0,192,3) if pixels[j]>180 and 35<pixels[j+1]<170 and pixels[j+2]<90)/64
  focus=orange<.6;consent=consent_rows[i]['consent_visible']=='True'
  joint.append({'frame':i,'time_seconds':i/25,'reduced_density_video':focus,'consent_visible':consent})
  if focus and consent:high_consent.append(i)
 with (folder/'center-frame-focus-consent.csv').open('w') as f:
  writer=csv.DictWriter(f,fieldnames=list(joint[0]));writer.writeheader();writer.writerows(joint)
 checks['no_consent_during_video_focus']=not high_consent

 # Decode all encoded frames in the bottom strip to catch the recorder's known gray padding failure.
 padding={}
 for role,stream in v['streams'].items():
  data=subprocess.check_output(['ffmpeg','-v','error','-i',stream['file'],'-vf','crop=1920:20:0:1060,scale=32:1','-fps_mode','passthrough','-f','rawvideo','-pix_fmt','rgb24','pipe:1'])
  gray_frames=[]
  for i in range(len(data)//96):
   row=data[i*96:(i+1)*96]; uniform=sum(abs(row[j]-128)<=2 for j in range(96))>94
   if uniform:gray_frames.append(i)
  padding[role]={'frames_checked':len(data)//96,'recorder_gray_padding_frames':len(gray_frames)}
 checks['no_recorder_bottom_padding']=all(p['recorder_gray_padding_frames']==0 for p in padding.values())
 takes.append({'take':folder.name,'checks':checks,'roles':rolechecks,'encoded_frame_padding':padding,'gateway_messages':len(events),'early_consent_timecodes':v['centerFrameInspection']['prematureConsentRanges'],'event_seconds':{a:x['elapsedMs']/1000 for a,x in t.items()}})
manifest=json.load(open(root/'recording-freeze-manifest.json' if (root/'recording-freeze-manifest.json').exists() else 'artifacts/recording-freeze/recording-revision.json'))
hashes={p:hashlib.sha256(Path(p).read_bytes()).hexdigest()==h for p,h in manifest['hashes'].items()}
report={'source_revision':manifest['revision'],'frozen_hashes_unchanged':hashes,'takes':takes,'status':'PASS' if len(takes)==3 and all(hashes.values()) and all(all(t['checks'].values()) for t in takes) else 'INCOMPLETE_OR_FAILED','limitations':['25fps: each encoded frame is 40ms; compositor can coalesce shorter changes.','Six streams share event UTC origin, with calibration at native frame resolution; no hardware genlock.','Cloud/POI/ETA/vehicle and timed Film ACCEPT/RESUME are simulated.']}
(root/'delivery-validation.json').write_text(json.dumps(report,indent=2));print(json.dumps({'status':report['status'],'frozen':all(hashes.values()),'takes':[{'take':t['take'],'checks':t['checks'],'flash':t['early_consent_timecodes']} for t in takes]},indent=2))
