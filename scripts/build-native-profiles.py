#!/usr/bin/env python3
"""Build all optional standalone hardware profile WASM reactors from pinned source; no proprietary assets."""
from pathlib import Path
import argparse, hashlib, json, os, re, shutil, subprocess, tempfile
ROOT=Path(__file__).resolve().parents[1]
LOCK={
 'awe32emu':('https://github.com/turican0/AWE32Emu.git','17b0578fe59909dfaa784b5531d6d1a3a80729ce'),
 '86box':('https://github.com/86Box/86Box.git','141ae59ca07f63267384ea12024bc51e2371b49b'),
 'sound-carcass':('https://github.com/superctr/sound-carcass.git','6adfa172ccf59bd14fcd581601d3c64669cb0935'),
 'munt':('https://github.com/munt/munt.git','f5b968c4faf180c7e687346a4e0ad426eee5f2af'),
}
EXPORTS=['profile_abi','profile_model','profile_buffer','profile_init','profile_rate','profile_message','profile_sysex_buffer','profile_sysex','profile_render','profile_voices','profile_close']
FLAGS=['-O3','-sSTANDALONE_WASM=1','--no-entry','-sFILESYSTEM=0','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=33554432','-sMAXIMUM_MEMORY=536870912','-sSTACK_SIZE=1048576','-sEXPORTED_FUNCTIONS='+json.dumps(['_'+x for x in EXPORTS],separators=(',',':'))]

def run(*args,cwd=None): subprocess.run([str(a) for a in args],cwd=cwd,check=True)
def checkout(name,cache):
    url,rev=LOCK[name]; path=cache/name
    if not path.exists():
        # Fetched beside the cache and moved in once complete: a checkout that stopped partway is never taken for one.
        part=cache/(name+'.partial'); shutil.rmtree(part,ignore_errors=True); part.mkdir(parents=True)
        run('git','init',part); run('git','-C',part,'remote','add','origin',url)
        run('git','-C',part,'fetch','--depth=1','origin',rev); run('git','-C',part,'checkout','--detach','FETCH_HEAD')
        part.rename(path)
    # Its own repository, not one that holds the cache (git looks upward from a directory without one).
    if Path(subprocess.check_output(['git','-C',path,'rev-parse','--show-toplevel'],text=True).strip()).resolve()!=path.resolve():
        raise RuntimeError(f'{path} is no checkout of {name}: remove it and build again')
    head=subprocess.check_output(['git','-C',path,'rev-parse','HEAD'],text=True).strip()
    if head!=rev: raise RuntimeError(f'{path}: expected {rev}, got {head}')
    if subprocess.check_output(['git','-C',path,'status','--porcelain','--untracked-files=no'],text=True).strip(): raise RuntimeError(f'{path} has modifications')
    return path

def source_list(cmake,target):
    m=re.search(r'add_library\('+target+r' STATIC\s+(.*?)\n\)',cmake,re.S)
    if not m: raise RuntimeError(f'Cannot extract pinned source list {target}')
    names=m.group(1).split()
    if any(not re.fullmatch(r'src/[\w/]+\.c',x) for x in names): raise RuntimeError('Unexpected source list')
    return names

# The SC-55 and SC-55mkII boards and the parts they are made of, from the pinned library's own source lists.
SC_SOURCES=['src/board/sc55.c','src/board/sc55mk2.c','src/board/wave.c','src/board/matrix.c','src/cpu/h8500.c','src/dsp/gp.c','src/periph/sc55_hle.c','src/periph/lcd.c','src/periph/i8251.c','src/core/midi_queue.c','src/core/bus.c','src/core/state.c']
def sc(cache,tmp,model,out):
    src=checkout('sound-carcass',cache)
    cmake=(src/'CMakeLists.txt').read_text()
    if not set(SC_SOURCES)<=set(source_list(cmake,'scemu_core')+source_list(cmake,'scemu')): raise RuntimeError('Unexpected SoundCarcass source lists')
    # Not scemu.c: its model table links every board, and the XV, SH-2 and DSP cores need SLJIT code generators, which
    # have no wasm32 backend (SLJIT_CONFIG_UNSUPPORTED does not even compile at the pinned submodule). roland_sc.c takes
    # its place for one board. The H8/532 runs on the interpreter (SCEMU_H8500_JIT undefined), so core/jit.h needs SLJIT's
    # type names only and no SLJIT code is built or linked. Fixed memory: zero imports.
    shim=tmp/'sljit'; shim.mkdir()
    (shim/'sljitLir.h').write_text('/* core/jit.h type names only; no SLJIT code is built */\ntypedef int sljit_s32;\ntypedef int sljit_sw;\nstruct sljit_compiler;\n')
    flags=[f for f in FLAGS if not f.startswith(('-sALLOW_MEMORY_GROWTH','-sMAXIMUM_MEMORY'))]+['-sALLOW_MEMORY_GROWTH=0']
    run('emcc',*flags,'-std=c11',f'-DMODEL_ID={model}','-I'+str(src/'src'),'-I'+str(shim),ROOT/'native/profiles/roland_sc.c',*[src/f for f in SC_SOURCES],'-lm','-o',out)
    return ('SoundCarcass (scemu) by Ian Karlsson, BSD-3-Clause: the SC-55/SC-55mkII boards, H8/500 core, GP sound chip and '
            'peripherals listed in scripts/build-native-profiles.py SC_SOURCES. Adapter native/profiles/roland_sc.c, MIT.\n'
            'No Roland ROM, firmware or sample data is included; the user supplies the ROM images.\n\n'+(src/'LICENSE').read_text())

def cqm(cache,tmp,out):
    src=checkout('86box',cache)
    # Nuked CQM 0.9 beta (LGPL-2.1-or-later by its own header) without 86Box's ISA device driver from CQM_CLOCK on,
    # which needs the emulator's timers and CPU clock; the synthesis code above it compiles unchanged.
    c=(src/'src/sound/snd_cqm_nuked.c').read_text()
    h=(src/'src/include/86box/snd_cqm_nuked.h').read_text()
    cut='#define CQM_CLOCK'
    if c.count(cut)!=1 or h.count('} cqm_t;')!=1 or h.count('void CQM_Reset(')!=1: raise RuntimeError('Unexpected CQM source')
    notice=c[:c.index('*/')+2]
    c=c.split(cut)[0]
    c=re.sub(r'^#include (?:<86box/[^>]+>|"cpu\.h")\s*$', '', c, flags=re.M)
    c=c.replace('#define RSM_FRAC', '#include "cqm.h"\n#define RSM_FRAC',1)
    h=h.split('} cqm_t;')[0]+'} cqm_t;\n'+h[h.index('void CQM_Reset('):]
    (tmp/'cqm.c').write_text(c); (tmp/'cqm.h').write_text(h)
    A=ROOT/'native/adlmidi'; bridge=ROOT/'native/profiles'
    defs=['-DNDEBUG','-DDEFUSS_OPL3_PER_SAMPLE',*['-DADLMIDI_DISABLE_'+x for x in ['MIDI_SEQUENCER','DOSBOX_EMULATOR','OPAL_EMULATOR','JAVA_EMULATOR','ESFMU_EMULATOR','MAME_OPL2_EMULATOR','YMFM_EMULATOR']],'-I'+str(A/'include'),'-I'+str(A/'src'),'-I'+str(A/'src/chips'),'-I'+str(tmp)]
    common=['-O2','-fwrapv',*defs]; objects=[]
    cfiles=[tmp/'cqm.c',A/'src/wopl/wopl_file.c',*sorted((A/'src/models').glob('model_*.c'))]
    cppfiles=[bridge/'cqm.cpp',bridge/'cqm_adlmidi.cpp',*[A/'src'/name for name in ['adlmidi.cpp','adlmidi_load.cpp','adlmidi_midiplay.cpp','adlmidi_opl3.cpp','adlmidi_private.cpp','inst_db.cpp']]]
    for f in cfiles+cppfiles:
        obj=tmp/(f.name+'.o'); objects.append(obj)
        run('emcc' if f.suffix=='.c' else 'em++',*common,*([] if f.suffix=='.c' else ['-std=c++14','-fno-exceptions','-fno-rtti']),'-c',f,'-o',obj)
    run('em++',*FLAGS,'-fno-exceptions',*objects,'-o',out)
    text=lambda p:(A/p).read_text().strip()
    return '\n'.join(['sb16-cqm.wasm is built by scripts/build-native-profiles.py sb16-cqm from native/profiles/cqm.cpp',
        '(GPL-3.0-or-later), native/profiles/cqm_adlmidi.cpp (LGPL-2.1-or-later), libADLMIDI 1.6.2 (native/adlmidi,',
        'Copyright (c) 2010-2014 Joel Yliluoma and (c) 2015-2026 Vitaly Novichkov: the synthesizer GPL-3.0-or-later, the chip',
        'interface LGPL-2.1-or-later, the volume models, file reader and WOPL reader MIT) and Nuked CQM 0.9 beta from the 86Box',
        'commit above (src/sound/snd_cqm_nuked.c up to CQM_CLOCK, src/include/86box/snd_cqm_nuked.h; LGPL-2.1-or-later).',
        'The combined module is distributed under GPL-3.0-or-later. Its Corresponding Source is that 86Box commit,',
        'this package\'s native/ directory and that script. The notices and licence texts follow.',
        '','== Nuked CQM ==',notice,'','== MIT (volume models) ==',text('src/models/LICENSE.txt'),
        '','== MIT (file reader, WOPL reader) ==',text('src/midiseq/LICENSE.txt'),
        '','== GNU Lesser General Public License 2.1 ==',text('LICENSE.LGPL-2.1.txt'),
        '','== GNU General Public License 3.0 ==',text('LICENSE.GPL-3.txt'),''])

def mt32(cache,tmp,out):
    from concurrent.futures import ThreadPoolExecutor
    src=checkout('munt',cache)/'mt32emu'; cmake=(src/'CMakeLists.txt').read_text()
    # Upstream's default static libmt32emu: its pinned source lists (core, C interface, internal resampler) and the
    # config.h its configure_file writes for a static build exporting every API type without version tagging.
    def listed(name):
        m=re.search(r'set\('+name+r'\s+(.*?)\n\)',cmake,re.S); files=m.group(1).split() if m else []
        if not files or any(not re.fullmatch(r'src/[\w/]+\.cpp',x) for x in files): raise RuntimeError(f'Unexpected Munt source list {name}')
        return files
    files=[x for name in ('CPP_SOURCES','C_SOURCES','INTERNAL_RESAMPLER_SOURCES') for x in listed('libmt32emu_'+name)]
    v=dict(re.findall(r'set\(libmt32emu_VERSION_(MAJOR|MINOR|PATCH) (\d+)\)',(src/'cmake/project_data.cmake').read_text()))
    if sorted(v)!=['MAJOR','MINOR','PATCH']: raise RuntimeError('Unexpected Munt version data')
    values={'libmt32emu_VERSION':'.'.join(v[k] for k in ('MAJOR','MINOR','PATCH')),**{'libmt32emu_VERSION_'+k:v[k] for k in v},
        'libmt32emu_EXPORTS_TYPE':'3','libmt32emu_SHARED_DEFINITION':'#undef MT32EMU_SHARED','libmt32emu_RUNTIME_VERSION_CHECK':'0'}
    inc=tmp/'mt32emu-config'; inc.mkdir()
    (inc/'config.h').write_text(re.sub(r'@(\w+)@',lambda m:values[m.group(1)],(src/'src/config.h.in').read_text()))
    # Upstream's CMake defaults: ANSI C++ (-ansi), internal resampler, "Fast" float math; Emscripten's libc has snprintf and exp2f.
    cxx=['-O3','-std=c++98','-DNDEBUG','-DMT32EMU_WITH_INTERNAL_RESAMPLER','-DMT32EMU_FASTER_MATH=1','-DMT32EMU_WITH_SNPRINTF','-DMT32EMU_WITH_EXP2F','-I'+str(inc),'-I'+str(src/'src')]
    objects=[tmp/(f.replace('/','_')+'.o') for f in files]
    with ThreadPoolExecutor(os.cpu_count()) as pool: list(pool.map(lambda f,o:run('em++',*cxx,'-c',src/f,'-o',o),files,objects))
    lib=tmp/'libmt32emu.a'; run('emar','rcs',lib,*objects)
    run('em++',*FLAGS,*cxx,ROOT/'native/profiles/roland_mt32.cpp',lib,'-o',out)
    sha1=(src/'src/sha1/sha1.cpp').read_text(); sha1=sha1[:sha1.index('*/')+2]
    return (f'libmt32emu {values["libmt32emu_VERSION"]} (Munt) by Dean Beeler, Jerome Fisher, Sergey V. Mikayev and contributors, '
        'LGPL-2.1-or-later, statically linked. Adapter native/profiles/roland_mt32.cpp: MIT. To relink with a modified libmt32emu, '
        'run scripts/build-native-profiles.py roland-mt32 against your source tree.\n\nlibmt32emu src/sha1 (BSD-3-Clause):\n'
        +sha1+'\n\n'+(src/'COPYING.LESSER.txt').read_text()+'\n'+(src/'COPYING.txt').read_text())

def awe(cache,tmp,model,out):
    # Local evaluation only: AWE32Emu's driver layer has no licence yet (README "Credits and license"), and a build
    # with the 86Box EMU8000 core is GPL-2.0-or-later. The pinned files compile unmodified; awe.cpp supplies fopen().
    src=checkout('awe32emu',cache)/'AWE32Emu/src'
    inc=['-I'+str(ROOT/'native/profiles'),'-I'+str(src),'-I'+str(src/'86box/include'),'-DAWE32EMU_WITH_86BOX',f'-DMODEL_ID={model}','-DNDEBUG','-O3','-fwrapv']
    objects=[]
    for f in [src/'86box/snd_emu8k.c',*[src/x for x in ['Synth.cpp','Emu8000.cpp','Emu8000Box.cpp','SoundFont.cpp','I18n.cpp']],ROOT/'native/profiles/awe.cpp']:
        obj=tmp/(f.name+'.o'); objects.append(obj)
        run('emcc' if f.suffix=='.c' else 'em++',*inc,*([] if f.suffix=='.c' else ['-std=c++17','-fno-exceptions']),'-c',f,'-o',obj)
    run('em++',*FLAGS,'-fno-exceptions',*objects,'-o',out)
    readme=(src.parent.parent/'README.md').read_text()
    return ('LOCAL BUILD ONLY - DO NOT DISTRIBUTE. AWE32Emu by turican0: its driver layer and the rest of the project have no licence '
        '("The license of the rest of the project is to be decided.", README.md). The EMU8000 core AWE32Emu/src/86box/snd_emu8k.c comes '
        'from 86Box and is GPL-2.0-or-later; a build that includes it is a derivative work of 86Box (README.md, AWE32Emu/src/86box/README.md).\n\n'
        + readme[readme.index('## Credits and license'):])

def standalone(model,out):
    file='pci128.c' if model==5 else 'gus.c'
    run('emcc',*FLAGS,'-std=c11',ROOT/'native/profiles'/file,'-o',out)
    return ('Native ECW reconstruction; ECW format based on Engelmann spec and public-domain ecw2sfz r3.\n' if model==5 else (ROOT/'native/profiles/gf1_mixer.h').read_text())

def check(wasm,model):
    run('node','--input-type=module','-e',r'''import fs from 'node:fs';
const module = new WebAssembly.Module(fs.readFileSync(process.argv[1]));
const allowed = {env:['emscripten_notify_memory_growth'],wasi_snapshot_preview1:['proc_exit','environ_sizes_get','environ_get','fd_close','fd_seek','fd_write']};
for (const x of WebAssembly.Module.imports(module)) if (x.kind !== 'function' || !allowed[x.module]?.includes(x.name)) throw Error('Unsupported import '+x.module+'.'+x.name);
const e = WebAssembly.Module.exports(module).map(x=>x.name);
for(const x of JSON.parse(process.argv[2])) if(!e.includes(x)) throw Error('Missing export '+x);
console.log('Static ABI check passed',process.argv[1]);''',wasm,json.dumps(['memory']+EXPORTS))

def main():
    p=argparse.ArgumentParser(description=__doc__); p.add_argument('profiles',nargs='+',choices=['sb16-cqm','awe32','awe64','sb-pci128','gus-gf1','roland-sc55','roland-sc55mk2','roland-mt32']); p.add_argument('--cache',type=Path,default=ROOT/'profile-assets/sources'); p.add_argument('--local-awe',action='store_true',help='Allow local build of AWE32Emu (driver redistribution license undecided)'); a=p.parse_args()
    if any(x in a.profiles for x in ('awe32','awe64')) and not a.local_awe: raise SystemExit('AWE32Emu driver is not licensed for redistribution; --local-awe builds only for local evaluation')
    for cmd in ['emcc','em++','emar','node','git']:
        if not shutil.which(cmd): raise SystemExit(f'Missing {cmd}; activate a pinned Emscripten SDK first (upstream uses 4.0.10)')
    dest=ROOT/'vendor/runtime/profiles'; dest.mkdir(parents=True,exist_ok=True)
    a.cache=a.cache.resolve(); a.cache.mkdir(parents=True,exist_ok=True)
    for profile in dict.fromkeys(a.profiles):
        with tempfile.TemporaryDirectory() as td:
            tmp=Path(td); wasm=tmp/(profile+'.wasm'); model={'sb16-cqm':2,'awe32':3,'awe64':4,'sb-pci128':5,'gus-gf1':6,'roland-sc55':7,'roland-sc55mk2':8,'roland-mt32':9}[profile]
            notice=cqm(a.cache,tmp,wasm) if model==2 else awe(a.cache,tmp,model,wasm) if model in (3,4) else standalone(model,wasm) if model in (5,6) else mt32(a.cache,tmp,wasm) if model==9 else sc(a.cache,tmp,model,wasm)
            check(wasm,model)
            # Local builds only. Before distributing, include complete corresponding source for GPL/LGPL cores as applicable.
            target=dest if model not in (3,4) else ROOT/'profile-assets/local-builds'
            target.mkdir(parents=True,exist_ok=True)
            shutil.copy2(wasm,target/wasm.name)
            (target/(profile+'.LICENSE.txt')).write_text('Pinned source: '+str(LOCK['86box' if model==2 else 'awe32emu' if model in (3,4) else 'munt' if model==9 else 'sound-carcass'] if model not in (5,6) else 'in-tree source')+'\n\n'+notice)
            print(profile,hashlib.sha256(wasm.read_bytes()).hexdigest())
if __name__=='__main__': main()
