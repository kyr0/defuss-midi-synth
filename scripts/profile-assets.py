#!/usr/bin/env python3
"""Acquire/validate legally supplied banks and ROMs. No proprietary asset is bundled.
fetch supports arbitrary explicit HTTPS URLs + mandatory SHA256; pack is offline and atomic.
"""
import argparse, hashlib, os, re, struct, tempfile, urllib.request, urllib.parse, json, subprocess
from pathlib import Path
LIMIT=128*1024*1024
PROFILES={'sb16-cqm':2,'awe32':3,'awe64':4,'sb-pci128':5,'gus-gf1':6,'roland-sc55':7,'roland-sc55mk2':8,'roland-mt32':9}
# Known publicly served user-owned project's SoundFont. Hash must still be supplied explicitly.
KNOWN={'opl3-sampled':'https://huggingface.co/kyr0/midi-synth/resolve/main/soundfonts/OPL-3_FM_128M/OPL-3_FM_128M.sf2.br'}
def sha(path):
    h=hashlib.sha256()
    with path.open('rb') as f:
        for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
    return h.hexdigest()
def fetch(url,dest,digest):
    url=KNOWN.get(url,url)
    if urllib.parse.urlparse(url).scheme!='https' or not re.fullmatch('[a-fA-F0-9]{64}',digest): raise ValueError('HTTPS and exact SHA-256 required')
    dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists():
        if sha(dest)==digest.lower(): return
        raise FileExistsError(f'{dest}: existing file hash differs')
    fd,tmp=tempfile.mkstemp(dir=dest.parent,prefix='.download-'); os.close(fd); tmp=Path(tmp)
    try:
        h=hashlib.sha256(); n=0
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'defuss-midi-synth/0.4.0'}),timeout=60) as r,tmp.open('wb') as out:
            if urllib.parse.urlparse(r.geturl()).scheme!='https': raise ValueError('Non-HTTPS redirect')
            for block in iter(lambda:r.read(1024*1024),b''):
                n+=len(block)
                if n>LIMIT: raise ValueError('Asset too large')
                h.update(block); out.write(block)
        if not n or h.hexdigest()!=digest.lower(): raise ValueError('SHA-256 mismatch')
        os.link(tmp,dest) # atomic; never overwrite a different asset
    finally: tmp.unlink(missing_ok=True)
# OEM-hosted original driver payloads (directory listings verified; binary retrieval
# could not be verified from the development sandbox). First-use lock records
# observed SHA256, NOT independent authentication of the vendor's bytes.
ECW_DIRS=[
 'https://ftp.emacinc.com/LegacyProducts/SBC/pcm-5896/Drivers/sound/AUDIO/ENGLISH/WIN95DRV/',
 'https://ftp.emacinc.com/LegacyProducts/SBC/pcm-7890/Drivers/pcm_7890_sound/sound/AUDIO/ENGLISH/WIN95DRV/',
 'https://ftp.emacinc.com/LegacyProducts/SBC/pcm-5864/Drivers/AUDIO/DRIVER/WIN95DRV/',
]
ECW_FILES={'EAPCI2M.ECW':2259070,'EAPCI4M.ECW':4986999,'EAPCI8M.ECW':8292462}
# Exact sizes from flaterco.com/kb/audio/Semi_MIDI_DOS.html. Other legitimate
# revisions may have different lengths: import those explicitly via pack.
def inspect_ecw(data):
    if len(data)<0x78c or data[:4]!=b'ECLW': raise ValueError('Not an ECLW waveset')
    ranges=[]
    for h,stride in [(0x704,256),(0x710,256),(0x71c,256),(0x728,256),(0x734,23),(0x740,76),(0x750,2),(0x768,2),(0x774,16)]:
        offset,n,count=struct.unpack_from('<III',data,h)
        if not count or n!=stride*count or offset<0x78c or offset+n>len(data) or (h in (0x704,0x710) and count!=1): raise ValueError(f'Malformed ECW table {h:#x}')
        ranges.append((offset,n,count))
    offset,n=struct.unpack_from('<II',data,0x784)
    if offset<0x78c or offset+n>len(data) or n<2: raise ValueError('Invalid ECW waveform area')
    return {'name':data[0x60:0xb0].split(b'\0')[0].decode('ascii','replace').strip(),'bytes':len(data),'instruments':ranges[4][2],'patches':ranges[5][2],'samples':ranges[8][2]}
def fetch_ecw(directory,expected_lock=None):
    directory.mkdir(parents=True,exist_ok=True); lock=directory/'ecw-lock.json'
    expected=json.loads(expected_lock.read_text()) if expected_lock else (json.loads(lock.read_text()) if lock.exists() else {})
    result={}
    for name,size in ECW_FILES.items():
        path=directory/name; source=expected.get(name,{}).get('url')
        wanted=expected.get(name,{}).get('sha256')
        if not path.exists():
            errors=[]
            for base in ECW_DIRS:
                url=base+name; tmp=None
                try:
                    fd,raw=tempfile.mkstemp(dir=directory,prefix='.ecw-');os.close(fd);tmp=Path(raw)
                    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'defuss-midi-synth/0.4.0'}),timeout=60) as r,tmp.open('wb') as out:
                        if urllib.parse.urlparse(r.geturl()).scheme!='https': raise ValueError('Non-HTTPS redirect')
                        n=0
                        for block in iter(lambda:r.read(65536),b''):
                            n+=len(block)
                            if n>size:raise ValueError('Unexpected waveset size')
                            out.write(block)
                    if tmp.stat().st_size!=size:raise ValueError('Unexpected waveset size')
                    inspect_ecw(tmp.read_bytes()); digest=sha(tmp)
                    if wanted and wanted!=digest:raise ValueError('Waveset SHA-256 mismatch')
                    os.link(tmp,path);source=url;break
                except Exception as e:errors.append(f'{url}: {e}')
                finally:
                    if tmp:tmp.unlink(missing_ok=True)
            if not path.exists():raise RuntimeError('Could not acquire '+name+'; supply the original driver file. '+ '; '.join(errors))
        data=path.read_bytes();info=inspect_ecw(data)
        if len(data)!=size:raise ValueError(f'{path}: unexpected size; import revision explicitly using pack')
        digest=hashlib.sha256(data).hexdigest()
        if wanted and digest!=wanted:raise ValueError(f'{path}: locked hash mismatch')
        result[name]={'url':source,'sha256':digest,**info}
        pack('sb-pci128',[f'32={path}'],directory/(name+'.dspack'))
        print(name,digest,info['name'])
    # Atomic replace only the metadata; raw banks/packs are never overwritten.
    fd,tmp=tempfile.mkstemp(dir=directory,prefix='.lock-');os.close(fd);tmp=Path(tmp)
    try:tmp.write_text(json.dumps(result,indent=2)+'\n');os.replace(tmp,lock)
    finally:tmp.unlink(missing_ok=True)
    print('Acquired 3 wavesets; first-use SHA256 lock:',lock)
    print('Use the desired .ECW.dspack via profileSources or copy to local assets/profiles/sb-pci128.dspack')
def gus_pack(mapping,output,voices=32):
    # JSON maps decimal program IDs (0..127) and drum keys (128+MIDI note)
    # to original .PAT files, relative to the mapping file. No SF2 conversion.
    source=json.loads(mapping.read_text()); paths={}
    for key,value in source.items():
        i=int(key)
        if i<0 or i>255 or i in paths or not isinstance(value,str):raise ValueError('Invalid/duplicate PAT mapping')
        file=mapping.parent/value;data=file.read_bytes()
        if len(data)<129 or data[:11]!=b'GF1PATCH110':raise ValueError(f'Invalid PAT: {file}')
        paths[i]=data
    if not paths:raise ValueError('Empty GUS mapping')
    if not 14<=voices<=32:raise ValueError('GF1 voices: 14..32')
    bank=b'GPAT'+struct.pack('<II',1,len(paths))+b''.join(struct.pack('<II',i,len(x))+x for i,x in sorted(paths.items()))
    if len(bank)>LIMIT:raise ValueError('GUS bank exceeds pack limit')
    with tempfile.TemporaryDirectory() as td:
        p=Path(td)/'bank';p.write_bytes(bank);v=Path(td)/'voices';v.write_bytes(bytes([voices]));pack('gus-gf1',[f'32={p}',f'33={v}'],output)
GUS_MANIFEST='https://raw.githubusercontent.com/Lost-Engines/darker-cpp/4d8e73863859c2b5d5b655ac3e031ccdb25c4aee/scripts/'
GUS_URL='https://raw.githubusercontent.com/alinebee/Boxer/master/Resources/DOS%20Toolkit/ULTRASND/MIDI/'
def ultramid_mapping(ini, memory=1024):
    if memory not in (256,512,768,1024):raise ValueError('Invalid UltraMID memory profile')
    rows={}
    for line in ini.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):continue
        fields=[x.strip() for x in line.split(',')]
        if len(fields)!=6 or not re.fullmatch(r'[a-zA-Z0-9_-]+',fields[5]):raise ValueError('Invalid ULTRAMID.INI row')
        k=int(fields[0]);rows[k]=(int(fields[memory//256]),fields[5].upper()+'.PAT')
    if not set(range(128))<=rows.keys():raise ValueError('Incomplete ULTRAMID map')
    return {str(k):rows[target][1] for k,(target,_) in rows.items() if 0<=k<256 and k!=128}
def fetch_gus(directory, memory=1024, voices=32):
    directory.mkdir(parents=True,exist_ok=True)
    with urllib.request.urlopen(GUS_MANIFEST+'gravis.sha256',timeout=60) as response:
        text=response.read(65537)
    if len(text)>65536:raise ValueError('Manifest too large')
    hashes={}
    for line in text.decode('ascii').splitlines():
        digest,name=line.split(maxsplit=1)
        if name.startswith('ULTRASND/MIDI/'):
            name=name.rsplit('/',1)[1]
            if not re.fullmatch(r'[A-Z0-9_-]+\.(PAT|INI)',name):raise ValueError('Unsafe manifest path')
            hashes[name]=digest
    fetch(GUS_URL+'ULTRAMID.INI',directory/'ULTRAMID.INI',hashes['ULTRAMID.INI'])
    mapping=ultramid_mapping((directory/'ULTRAMID.INI').read_text(),memory)
    for name in sorted(set(mapping.values())):fetch(GUS_URL+name,directory/name,hashes[name])
    dest=directory/f'mapping-{memory}.json';payload=json.dumps(mapping,indent=2)+'\n'
    if dest.exists() and dest.read_text()!=payload:raise FileExistsError(dest)
    dest.write_text(payload)
    gus_pack(dest,directory/f'gus-gf1-{memory}k.dspack',voices)
    print('Original UltraMID patch bank mapped and packed:',directory/f'gus-gf1-{memory}k.dspack')
def pack_awe(profile,rom,bank,output,driver,rom_only,ram,user):
    if rom.stat().st_size not in (1048574,1048576):raise ValueError('Unexpected AWE ROM size')
    ram=ram or (512 if profile=='awe32' else 4096)
    if not 512<=ram<=28672 or ram%512:raise ValueError('AWE RAM must be 512..28672 KiB in 512 KiB steps')
    with tempfile.TemporaryDirectory() as td:
        cfg=Path(td)/'awe-config';cfg.write_bytes(struct.pack('<BBI',{'win95':0,'dos':1,'sdk':2}[driver],rom_only,ram))
        records=[f'3={rom}',f'32={bank}',f'33={cfg}']
        if user:records.append(f'34={user}')
        pack(profile,records,output)
def verify_ecw_reference(source,directory):
    # Execute the original public-domain Perl parser against each actual bank.
    # Compare sample payload with the direct C decoder's byte offset interpretation.
    for name in ECW_FILES:
        path=directory/name; data=path.read_bytes();inspect_ecw(data)
        off,_,n=struct.unpack_from('<III',data,0x774);wave=struct.unpack_from('<I',data,0x784)[0]
        start=min(struct.unpack_from('<I',data,off+i*16+4)[0]//8 for i in range(n))
        pcm=data[wave+start:];expected=hashlib.sha256(pcm[:len(pcm)//2*2]).hexdigest()
        actual=subprocess.check_output(['perl','-I'+str(source.resolve()),'-MMIDI::ECW','-MDigest::SHA=sha256_hex','-e','my $e=MIDI::ECW->new(filename=>$ARGV[0]); print sha256_hex(pack("s<*",$e->sample));',str(path)],text=True).strip()
        if actual!=expected:raise ValueError(f'{name}: ecw2sfz reference sample mismatch: {actual} != {expected}')
        print(name,'reference waveform SHA256 agrees',actual)
def reference_sources(directory):
    directory.mkdir(parents=True,exist_ok=True)
    target=directory/'ecw2sfz-r3'
    if target.exists():raise FileExistsError(target)
    subprocess.run(['svn','export','-r','3','https://svn.code.sf.net/p/ecw2sfz/code/trunk',str(target)],check=True)
    print('Original public-domain parser and converter:',target)
    print('SF2ECW 1.0a requires authorized download from https://www.tgames.fr/en/pc/progs-pc/sf2ecw-v1-0a-convert-any-sf2-soundfont-to-ecw-creative-ensoniq-sound-blaster-soundfonts-t12238.html')
def pack(profile,records,dest):
    ids={}; total=16
    for entry in records:
        role,path=entry.split('=',1); role=int(role); path=Path(path)
        if not 1<=role<=63 or role in ids: raise ValueError('Invalid/duplicate role')
        size=path.stat().st_size
        if size<=0: raise ValueError('Empty asset')
        total+=8+size
        if total>LIMIT: raise ValueError('Pack too large')
        ids[role]=path
    if not ids: raise ValueError('No records')
    if profile in ('roland-sc55','roland-sc55mk2'):
        roles=set(ids); wave=sorted(roles-{1,2})
        if not {1,2}<=roles or not (wave==[3] or (wave and wave==list(range(16,16+len(wave))) and len(wave)<=8)):
            raise ValueError('SC pack: boot=1, program=2, wave=3 OR contiguous raw chips=16..23')
    if profile=='sb16-cqm' and set(ids)!={32}: raise ValueError('CQM pack: WOPL bank=32')
    if profile=='roland-mt32' and set(ids)!={1,2}: raise ValueError('MT-32 pack: control=1, PCM=2')
    if profile=='sb-pci128':
        if set(ids)!={32}:raise ValueError('PCI128: original ECW bank role 32')
        inspect_ecw(ids[32].read_bytes())
    if profile in ('awe32','awe64') and (not {3,32}<=set(ids) or not set(ids)<={3,32,33,34}):raise ValueError('AWE: ROM=3, GM bank=32, optional driver config=33, user bank=34')
    if profile=='gus-gf1' and (not 32 in ids or not set(ids)<={32,33}):raise ValueError('GF1: GPAT bank=32, voice count=33')
    dest.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(dir=dest.parent,prefix='.pack-'); os.close(fd); tmp=Path(tmp)
    try:
        with tmp.open('wb') as f:
            f.write(struct.pack('<4sIII',b'DSPK',1,PROFILES[profile],len(ids)))
            for role,path in sorted(ids.items()):
                data=path.read_bytes(); f.write(struct.pack('<II',role,len(data))); f.write(data)
            if f.tell()!=total: raise ValueError('Source changed while packing')
        if dest.exists():
            if sha(dest)==sha(tmp): return
            raise FileExistsError(f'{dest}: refusing to overwrite existing pack')
        os.link(tmp,dest)
    finally: tmp.unlink(missing_ok=True)

def main():
    p=argparse.ArgumentParser(description=__doc__); s=p.add_subparsers(dest='cmd',required=True)
    f=s.add_parser('fetch'); f.add_argument('url'); f.add_argument('destination',type=Path); f.add_argument('--sha256',required=True)
    q=s.add_parser('pack'); q.add_argument('profile',choices=PROFILES); q.add_argument('destination',type=Path); q.add_argument('records',nargs='+',metavar='ROLE=FILE')
    e=s.add_parser('fetch-ecw'); e.add_argument('directory',type=Path); e.add_argument('--lock',type=Path,help='Prior trusted or first-use ecw-lock.json')
    g=s.add_parser('pack-gus');g.add_argument('mapping',type=Path);g.add_argument('destination',type=Path);g.add_argument('--voices',type=int,default=32)
    r=s.add_parser('fetch-ecw-reference');r.add_argument('directory',type=Path)
    v=s.add_parser('verify-ecw-reference');v.add_argument('source',type=Path);v.add_argument('directory',type=Path)
    g2=s.add_parser('fetch-gus');g2.add_argument('directory',type=Path);g2.add_argument('--memory',type=int,choices=[256,512,768,1024],default=1024);g2.add_argument('--voices',type=int,default=32)
    aw=s.add_parser('pack-awe');aw.add_argument('profile',choices=['awe32','awe64']);aw.add_argument('rom',type=Path);aw.add_argument('bank',type=Path);aw.add_argument('destination',type=Path);aw.add_argument('--driver',choices=['win95','dos','sdk'],default='win95');aw.add_argument('--rom-only',action='store_true');aw.add_argument('--ram',type=int);aw.add_argument('--user-bank',type=Path)
    ar=s.add_parser('fetch-awe-rom');ar.add_argument('destination',type=Path)
    a=p.parse_args()
    if a.cmd=='fetch-ecw':fetch_ecw(a.directory,a.lock);return
    if a.cmd=='pack-gus':gus_pack(a.mapping,a.destination,a.voices);print(sha(a.destination),a.destination);return
    if a.cmd=='fetch-ecw-reference':reference_sources(a.directory);return
    if a.cmd=='verify-ecw-reference':verify_ecw_reference(a.source,a.directory);return
    if a.cmd=='fetch-gus':fetch_gus(a.directory,a.memory,a.voices);return
    if a.cmd=='pack-awe':pack_awe(a.profile,a.rom,a.bank,a.destination,a.driver,a.rom_only,a.ram,a.user_bank);return
    if a.cmd=='fetch-awe-rom':fetch('https://raw.githubusercontent.com/86Box/roms/master/sound/creative/awe32.raw',a.destination,'4e143b94f758734f594ded78f4e5115635975c16fa37fabeae0baa4938ca710e');return
    if a.cmd=='fetch': fetch(a.url,a.destination,a.sha256); print(sha(a.destination),a.destination)
    else: pack(a.profile,a.records,a.destination); print(sha(a.destination),a.destination)
if __name__=='__main__': main()
