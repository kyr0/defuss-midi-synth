#!/usr/bin/env python3
"""Acquire/validate legally supplied banks and ROMs. No proprietary asset is bundled.
fetch supports arbitrary explicit HTTPS URLs + mandatory SHA256; pack is offline and atomic.
"""
import argparse, hashlib, os, re, shutil, ssl, struct, tempfile, urllib.error, urllib.request, urllib.parse, json, subprocess
from pathlib import Path
LIMIT=128*1024*1024
PROFILES={'sb16-cqm':2,'awe32':3,'awe64':4,'sb-pci128':5,'gus-gf1':6}
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
# OEM-hosted original driver payloads. EMAC serves byte-identical copies on all three paths (uploads dated 2006
# and 2009, fetched 2026-11-25); each copy's waveform area ends exactly at EOF. flaterco.com/kb/audio/Semi_MIDI_DOS.html
# lists 2,259,070 and 8,292,462 bytes for the 2M and 8M files: another revision, import such files with `pack`.
ECW_DIRS=[
 'https://ftp.emacinc.com/LegacyProducts/SBC/pcm-5896/Drivers/sound/AUDIO/ENGLISH/WIN95DRV/',
 'https://ftp.emacinc.com/LegacyProducts/SBC/pcm-7890/Drivers/pcm_7890_sound/sound/AUDIO/ENGLISH/WIN95DRV/',
 'https://ftp.emacinc.com/LegacyProducts/SBC/pcm-5864/Drivers/AUDIO/DRIVER/WIN95DRV/',
]
ECW_FILES={
 'EAPCI2M.ECW':(2259067,'984c5097d9b4cc66674b0ec250bdd1c0d3081b076d418d5fc207da52868f8e81'),
 'EAPCI4M.ECW':(4986999,'411612743edbde4c6cd19a45a09974c9ce508056b18fb0edaaaad5c7eea4f5db'),
 'EAPCI8M.ECW':(8292459,'4995a23e7a4c34a96f1a223f0d648eb497ae845aa42877cba193bc8cbc84293f'),
}
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
def download_https(url,dest,size):
    """Write at most size bytes of url to dest. EMAC sends an incomplete certificate chain that Python's OpenSSL
    cannot complete; curl with the system trust store can. Both verify the certificate; callers check SHA-256."""
    try:
        with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'defuss-midi-synth/0.4.0'}),timeout=60) as r,dest.open('wb') as out:
            if urllib.parse.urlparse(r.geturl()).scheme!='https': raise ValueError('Non-HTTPS redirect')
            n=0
            for block in iter(lambda:r.read(65536),b''):
                n+=len(block)
                if n>size:raise ValueError('Unexpected size')
                out.write(block)
    except urllib.error.URLError as e:
        if not isinstance(e.reason,ssl.SSLCertVerificationError):raise
        subprocess.run(['curl','--fail','--silent','--show-error','--proto','=https','--proto-redir','=https','--max-filesize',str(size),'--max-time','300','-o',str(dest),url],check=True)
def fetch_ecw(directory,expected_lock=None):
    directory.mkdir(parents=True,exist_ok=True); lock=directory/'ecw-lock.json'
    expected=json.loads(expected_lock.read_text()) if expected_lock else (json.loads(lock.read_text()) if lock.exists() else {})
    result={}
    for name,(size,pinned) in ECW_FILES.items():
        path=directory/name; source=expected.get(name,{}).get('url')
        wanted=expected.get(name,{}).get('sha256') or pinned
        if not path.exists():
            errors=[]
            for base in ECW_DIRS:
                url=base+name; tmp=None
                try:
                    fd,raw=tempfile.mkstemp(dir=directory,prefix='.ecw-');os.close(fd);tmp=Path(raw)
                    download_https(url,tmp,size)
                    if tmp.stat().st_size!=size:raise ValueError('Unexpected waveset size')
                    inspect_ecw(tmp.read_bytes()); digest=sha(tmp)
                    if wanted!=digest:raise ValueError('Waveset SHA-256 mismatch')
                    os.link(tmp,path);source=url;break
                except Exception as e:errors.append(f'{url}: {e}')
                finally:
                    if tmp:tmp.unlink(missing_ok=True)
            if not path.exists():raise RuntimeError('Could not acquire '+name+'; supply the original driver file. '+ '; '.join(errors))
        data=path.read_bytes();info=inspect_ecw(data)
        if len(data)!=size:raise ValueError(f'{path}: unexpected size; import revision explicitly using pack')
        digest=hashlib.sha256(data).hexdigest()
        if digest!=wanted:raise ValueError(f'{path}: SHA-256 {digest} differs from {wanted}')
        result[name]={'url':source,'sha256':digest,**info}
        pack('sb-pci128',[f'32={path}'],directory/(name+'.dspack'))
        print(name,digest,info['name'])
    # Atomic replace only the metadata; raw banks/packs are never overwritten.
    fd,tmp=tempfile.mkstemp(dir=directory,prefix='.lock-');os.close(fd);tmp=Path(tmp)
    try:tmp.write_text(json.dumps(result,indent=2)+'\n');os.replace(tmp,lock)
    finally:tmp.unlink(missing_ok=True)
    print('Acquired 3 wavesets; SHA-256 lock:',lock)
    print('Use the desired .ECW.dspack via profileSources or copy to local assets/profiles/sb-pci128.dspack')
def gus_pack(mapping,output,voices=32,sixteen_bit=False,preload=False):
    # JSON maps decimal program IDs (0..127) and drum keys (128+MIDI note)
    # to original .PAT files, relative to the mapping file. No SF2 conversion.
    # Role 33 (native/profiles/gus.c): active voices, then flags 1 = keep 16-bit
    # waves (UltraMID -16), 2 = preload every patch (UltraMID -c); not both.
    source=json.loads(mapping.read_text()); paths={}
    for key,value in source.items():
        i=int(key)
        if i<0 or i>255 or i in paths or not isinstance(value,str):raise ValueError('Invalid/duplicate PAT mapping')
        file=mapping.parent/value;data=file.read_bytes()
        if len(data)<129 or data[:11]!=b'GF1PATCH110':raise ValueError(f'Invalid PAT: {file}')
        paths[i]=data
    if not paths:raise ValueError('Empty GUS mapping')
    if not 14<=voices<=32:raise ValueError('GF1 voices: 14..32')
    if sixteen_bit and preload:raise ValueError("UltraMID: can't use -16 and -c together")
    bank=b'GPAT'+struct.pack('<II',1,len(paths))+b''.join(struct.pack('<II',i,len(x))+x for i,x in sorted(paths.items()))
    if len(bank)>LIMIT:raise ValueError('GUS bank exceeds pack limit')
    flags=(1 if sixteen_bit else 0)|(2 if preload else 0)
    with tempfile.TemporaryDirectory() as td:
        p=Path(td)/'bank';p.write_bytes(bank);v=Path(td)/'driver';v.write_bytes(bytes([voices,flags] if flags else [voices]));pack('gus-gf1',[f'32={p}',f'33={v}'],output)
GUS_MANIFEST='https://raw.githubusercontent.com/Lost-Engines/darker-cpp/4d8e73863859c2b5d5b655ac3e031ccdb25c4aee/scripts/'
# Boxer's DOS Toolkit copy of the Gravis files; the directory is unchanged since 1b587e2 (2009).
GUS_URL='https://raw.githubusercontent.com/alinebee/Boxer/0062fc18e154cde6cef3bf3329be4b0658597e31/Resources/DOS%20Toolkit/ULTRASND/MIDI/'
def ultramid_mapping(ini, memory=1024):
    # ULTRAMID.INI rows: patch number (0..127 melodic, 128 blank, 128+note drums),
    # substitute patch number for 256K, 512K, 768K and 1024K of GUS DRAM, patch name.
    if memory not in (256,512,768,1024):raise ValueError('Invalid UltraMID memory profile')
    rows={}
    for line in ini.splitlines():
        if not line.strip() or line.lstrip().startswith('#'):continue
        fields=[x.strip() for x in line.split(',')]
        if len(fields)!=6 or not re.fullmatch(r'[a-zA-Z0-9_-]+',fields[5]):raise ValueError('Invalid ULTRAMID.INI row')
        k=int(fields[0])
        if k in rows or not 0<=k<256:raise ValueError('Duplicate or out-of-range ULTRAMID.INI row')
        rows[k]=(int(fields[memory//256]),fields[5].upper()+'.PAT')
    if not set(range(129))<=rows.keys():raise ValueError('Incomplete ULTRAMID map')
    return {str(k):rows[target][1] for k,(target,_) in rows.items() if k!=128}
def fetch_gus(directory, memory=1024, voices=32, sixteen_bit=False, preload=False):
    directory.mkdir(parents=True,exist_ok=True)
    with urllib.request.urlopen(GUS_MANIFEST+'gravis.sha256',timeout=60) as response:
        text=response.read(65537)
    if len(text)>65536:raise ValueError('Manifest too large')
    hashes={}
    for line in text.decode('ascii').splitlines():
        digest,name=line.split(maxsplit=1)
        if name.startswith('ULTRASND/MIDI/'):
            name=name.rsplit('/',1)[1]
            if not re.fullmatch(r'[A-Z0-9_-]+\.(PAT|INI)',name) or not re.fullmatch('[0-9a-f]{64}',digest):raise ValueError('Unsafe manifest entry')
            hashes[name]=digest
    saved=directory/'gravis.sha256' # kept so scripts/profile-gf1-test.mjs can re-check offline
    if saved.exists() and saved.read_bytes()!=text:raise FileExistsError(saved)
    saved.write_bytes(text)
    fetch(GUS_URL+'ULTRAMID.INI',directory/'ULTRAMID.INI',hashes['ULTRAMID.INI'])
    mapping=ultramid_mapping((directory/'ULTRAMID.INI').read_text(),memory)
    missing=sorted(set(mapping.values())-hashes.keys())
    if missing:raise ValueError(f'Not in the pinned manifest: {missing}')
    for name in sorted(set(mapping.values())):fetch(GUS_URL+name,directory/name,hashes[name])
    dest=directory/f'mapping-{memory}.json';payload=json.dumps(mapping,indent=2)+'\n'
    if dest.exists() and dest.read_text()!=payload:raise FileExistsError(dest)
    dest.write_text(payload)
    out=directory/f'gus-gf1-{memory}k{"-16bit" if sixteen_bit else ""}{"-preload" if preload else ""}.dspack'
    gus_pack(dest,out,voices,sixteen_bit,preload)
    print('Original UltraMID patch bank mapped and packed:',out)
def pack_awe(profile,rom,bank,output,driver,rom_only,ram,user,unverified_rom=False):
    # Roles as native/profiles/awe.cpp reads them: 3 = EMU8000 wave ROM (optional when every bank sample goes to DRAM),
    # 32 = primary SBK/SF2/SBAWE32.MDI bank, 33 = config (driver, primary bank describes the ROM, DRAM KiB), 34 = user bank.
    if rom_only and not rom:raise ValueError('--rom-only describes ROM samples and needs --rom')
    if rom:
        data=rom.read_bytes()
        if len(data) not in (1048574,1048576):raise ValueError('Unexpected AWE ROM size')
        digests={'sha1':hashlib.sha1(data).hexdigest(),'sha256':hashlib.sha256(data).hexdigest()}
        known=json.loads((Path(__file__).resolve().parent/'roms'/f'{profile}.json').read_text())['sets']
        if not unverified_rom and not any(f['role']==3 and any(f.get(k)==v for k,v in digests.items()) for s in known for f in s['files']):
            raise ValueError(f'{rom}: no known EMU8000 ROM revision has SHA-1 {digests["sha1"]}; pass --unverified-rom for a dump of your own card')
    for path in [bank]+([user] if user else []):
        with path.open('rb') as f:head=f.read(12)
        if not (head[:4]==b'RIFF' and head[8:12]==b'sfbk') and head[:7]!=b'AIL3MDI':raise ValueError(f'{path}: not an SBK/SF2 bank or SBAWE32.MDI')
    ram=ram or (512 if profile=='awe32' else 4096)
    if not 512<=ram<=28672 or ram%512:raise ValueError('AWE RAM must be 512..28672 KiB in 512 KiB steps')
    with tempfile.TemporaryDirectory() as td:
        cfg=Path(td)/'awe-config';cfg.write_bytes(struct.pack('<BBI',{'win95':0,'dos':1,'sdk':2}[driver],rom_only,ram))
        records=([f'3={rom}'] if rom else [])+[f'32={bank}',f'33={cfg}']
        if user:records.append(f'34={user}')
        pack(profile,records,output)
# ecw2sfz r3 (public domain, sourceforge.net/projects/ecw2sfz); SHA-256 of the files at r3, fetched 2026-11-25.
ECW2SFZ_R3={'ecw.txt':'7f3744ffa97d3138219797634fd6d3722ef8896d39f619f7027d32e6d1d376d8',
 'ecw2sfz.pl':'6c6fb9dd8a25ed27959c69b9130eb93b0b800ce5056b57173caa1f7ff6b43dd3',
 'MIDI/ECW.pm':'4e7ee9d0dedd90be04cafb74a051845af2aa2ea1a6e57034d2094d87715f9d2c',
 'MIDI/SFZ.pm':'aeb9feb957e750fa063ebaff289fe4787e99465015bb36d01b284409cea96cf6'}
# Runs ecw2sfz's own section readers (MIDI::ECW::_read_*) and prints what they decode as JSON.
ECW2SFZ_DUMP=r'''use strict;use warnings;use JSON::PP;use Digest::SHA qw(sha256_hex);use MIDI::ECW;
my $path=shift;open(my $fh,'<',$path) or die "$path: $!";binmode $fh;
my ($info,$ob,$od,$op,$cp,$on,$cn,$oi,$ci,$oh,$ch,$o1,$c1,$o2,$c2,$o3,$c3,$os,$cs,$ow)=MIDI::ECW::_read_header($fh,0);
my %r=(info=>$info,header=>{bank_map=>$ob,drum_kit_map=>$od,patch_maps=>[$op,$cp],drum_note_maps=>[$on,$cn],instruments=>[$oi,$ci],
 patches=>[$oh,$ch],array1=>[$o1,$c1],array2=>[$o2,$c2],array3=>[$o3,$c3],samples=>[$os,$cs],waveform=>$ow},
 bank_map=>[MIDI::ECW::_read_bank_map($fh,$ob)],drum_kit_map=>[MIDI::ECW::_read_bank_map($fh,$od)],
 patch_maps=>[MIDI::ECW::_read_patch_maps($fh,$op,$cp)],drum_note_maps=>[MIDI::ECW::_read_patch_maps($fh,$on,$cn)],
 instruments=>[MIDI::ECW::_read_instrument_headers($fh,$oi,$ci)],patches=>[MIDI::ECW::_read_patch_headers($fh,$oh,$ch)],
 array1=>[MIDI::ECW::_read_array($fh,$o1,$c1)],array3=>[MIDI::ECW::_read_array($fh,$o3,$c3)],samples=>[MIDI::ECW::_read_sample_headers($fh,$os,$cs)]);
close $fh;my $e=MIDI::ECW->new(filename=>$path);$r{waveform_sha256}=sha256_hex(pack('s<*',$e->sample));
print JSON::PP->new->ascii->canonical->encode(\%r);
'''
def verify_ecw_reference(source,directory):
    """Run ecw2sfz r3 on each waveset: its waveform dump must match ours byte for byte, and its decoded sections
    are saved as <name>.ecw2sfz.json for scripts/profile-ecw-test.mjs to compare against the C core."""
    for rel,digest in ECW2SFZ_R3.items():
        if sha(source/rel)!=digest:raise ValueError(f'{source/rel}: not the pinned ecw2sfz r3 file')
    for name in ECW_FILES:
        path=directory/name; data=path.read_bytes();inspect_ecw(data)
        off,_,n=struct.unpack_from('<III',data,0x774);wave=struct.unpack_from('<I',data,0x784)[0]
        start=min(struct.unpack_from('<I',data,off+i*16+4)[0]//8 for i in range(n))
        pcm=data[wave+start:];expected=hashlib.sha256(pcm[:len(pcm)//2*2]).hexdigest()
        dump=subprocess.run(['perl','-I'+str(source.resolve()),'-e',ECW2SFZ_DUMP,str(path)],check=True,capture_output=True,text=True).stdout
        actual=json.loads(dump)['waveform_sha256']
        if actual!=expected:raise ValueError(f'{name}: ecw2sfz reference sample mismatch: {actual} != {expected}')
        out=directory/(name+'.ecw2sfz.json');out.write_text(dump)
        print(name,'reference waveform SHA256 agrees',actual,'decoded sections:',out)
def reference_sources(directory):
    """ecw2sfz r3 via svn export, or without svn from SourceForge's raw r3 view; both are checked against ECW2SFZ_R3."""
    directory.mkdir(parents=True,exist_ok=True)
    target=directory/'ecw2sfz-r3'
    if not target.exists():
        if shutil.which('svn'):subprocess.run(['svn','export','-r','3','https://svn.code.sf.net/p/ecw2sfz/code/trunk',str(target)],check=True)
        else:
            for rel,digest in ECW2SFZ_R3.items():
                dest=target/rel;dest.parent.mkdir(parents=True,exist_ok=True)
                download_https(f'https://sourceforge.net/p/ecw2sfz/code/3/tree/trunk/{rel}?format=raw',dest,1<<20)
    for rel,digest in ECW2SFZ_R3.items():
        if sha(target/rel)!=digest:raise ValueError(f'{target/rel}: SHA-256 differs from ecw2sfz r3')
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
    if profile=='sb16-cqm' and set(ids) not in ({32},{33}): raise ValueError('CQM pack: one record, WOPL bank=32 or embedded bank number=33 (4 bytes, u32 LE)')
    if profile=='sb-pci128':
        if set(ids)!={32}:raise ValueError('PCI128: original ECW bank role 32')
        inspect_ecw(ids[32].read_bytes())
    if profile in ('awe32','awe64') and (32 not in ids or not set(ids)<={3,32,33,34}):raise ValueError('AWE: bank=32, optional ROM=3, driver config=33, user bank=34')
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
    g=s.add_parser('pack-gus');g.add_argument('mapping',type=Path);g.add_argument('destination',type=Path);g.add_argument('--voices',type=int,default=32);g.add_argument('--16-bit',dest='sixteen_bit',action='store_true');g.add_argument('--preload',action='store_true')
    r=s.add_parser('fetch-ecw-reference');r.add_argument('directory',type=Path)
    v=s.add_parser('verify-ecw-reference');v.add_argument('source',type=Path);v.add_argument('directory',type=Path)
    g2=s.add_parser('fetch-gus');g2.add_argument('directory',type=Path);g2.add_argument('--memory',type=int,choices=[256,512,768,1024],default=1024);g2.add_argument('--voices',type=int,default=32);g2.add_argument('--16-bit',dest='sixteen_bit',action='store_true');g2.add_argument('--preload',action='store_true')
    aw=s.add_parser('pack-awe');aw.add_argument('profile',choices=['awe32','awe64']);aw.add_argument('bank',type=Path);aw.add_argument('destination',type=Path);aw.add_argument('--rom',type=Path,help='EMU8000 wave ROM you supply (awe32.raw)');aw.add_argument('--unverified-rom',action='store_true',help='accept a ROM dump of your own card whose hash scripts/roms does not list');aw.add_argument('--driver',choices=['win95','dos','sdk'],default='win95');aw.add_argument('--rom-only',action='store_true');aw.add_argument('--ram',type=int);aw.add_argument('--user-bank',type=Path)
    a=p.parse_args()
    if a.cmd=='fetch-ecw':fetch_ecw(a.directory,a.lock);return
    if a.cmd=='pack-gus':gus_pack(a.mapping,a.destination,a.voices,a.sixteen_bit,a.preload);print(sha(a.destination),a.destination);return
    if a.cmd=='fetch-ecw-reference':reference_sources(a.directory);return
    if a.cmd=='verify-ecw-reference':verify_ecw_reference(a.source,a.directory);return
    if a.cmd=='fetch-gus':fetch_gus(a.directory,a.memory,a.voices,a.sixteen_bit,a.preload);return
    if a.cmd=='pack-awe':pack_awe(a.profile,a.rom,a.bank,a.destination,a.driver,a.rom_only,a.ram,a.user_bank,a.unverified_rom);print(sha(a.destination),a.destination);return
    if a.cmd=='fetch': fetch(a.url,a.destination,a.sha256); print(sha(a.destination),a.destination)
    else: pack(a.profile,a.records,a.destination); print(sha(a.destination),a.destination)
if __name__=='__main__': main()
