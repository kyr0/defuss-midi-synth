#!/usr/bin/env python3
"""Build the in-tree ECW and GF1 engines with LLVM (no Emscripten/sysroot needed)."""
import argparse,subprocess,shutil,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
CORES={'sb-pci128':'pci128.c','gus-gf1':'gus.c'}
EXPORTS=['profile_abi','profile_model','profile_buffer','profile_init','profile_rate','profile_message','profile_sysex_buffer','profile_sysex','profile_render','profile_voices','profile_close']
def build(root,dest):
    src=root/'native/profiles';rt=src/'freestanding';dest.mkdir(parents=True,exist_ok=True)
    clang=shutil.which('clang');
    if not clang: raise SystemExit('LLVM clang with wasm32 support required')
    for profile,file in CORES.items():
        output=dest/(profile+'.wasm')
        subprocess.run([clang,'--target=wasm32','-std=c11','-O3','-ffreestanding','-fno-builtin','-fvisibility=hidden','-nostdlib','-I'+str(rt),str(src/file),str(rt/'runtime.c'),'-Wl,--no-entry','-Wl,--export-memory','-Wl,-z,stack-size=65536','-Wl,--initial-memory=2097152','-Wl,--max-memory=268435456',*['-Wl,--export='+x for x in EXPORTS],'-o',str(output)],check=True)
        notice='ECW reconstruction: MIT; format references Engelmann specification 1.5 and public-domain ecw2sfz r3. No proprietary bank bundled.\n' if profile=='sb-pci128' else (src/'gf1_mixer.h').read_text()
        (dest/(profile+'.LICENSE.txt')).write_text(notice)
        print(profile,output.stat().st_size,hashlib.sha256(output.read_bytes()).hexdigest())
if __name__=='__main__':
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--root',type=Path,default=ROOT);p.add_argument('--output',type=Path);a=p.parse_args();build(a.root,a.output or a.root/'vendor/runtime/profiles')
