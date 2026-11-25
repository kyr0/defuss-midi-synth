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
EXPORTS=['profile_abi','profile_model','profile_buffer','profile_init','profile_rate','profile_message','profile_render','profile_voices','profile_close']
FLAGS=['-O3','-sSTANDALONE_WASM=1','--no-entry','-sFILESYSTEM=0','-sALLOW_MEMORY_GROWTH=1','-sINITIAL_MEMORY=33554432','-sMAXIMUM_MEMORY=536870912','-sSTACK_SIZE=1048576','-sEXPORTED_FUNCTIONS='+json.dumps(['_'+x for x in EXPORTS],separators=(',',':'))]

def run(*args,cwd=None): subprocess.run([str(a) for a in args],cwd=cwd,check=True)
def checkout(name,cache):
    url,rev=LOCK[name]; path=cache/name
    if not path.exists():
        path.mkdir(parents=True); run('git','init',path); run('git','-C',path,'remote','add','origin',url)
        run('git','-C',path,'fetch','--depth=1','origin',rev); run('git','-C',path,'checkout','--detach','FETCH_HEAD')
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

def sc(cache,tmp,model,out):
    src=checkout('sound-carcass',cache)
    run('git','-C',src,'submodule','update','--init','--depth','1','thirdparty/sljit')
    sljit=src/'thirdparty/sljit/sljit_src'
    actual=subprocess.check_output(['git','-C',sljit.parent,'rev-parse','HEAD'],text=True).strip()
    if actual!='a0020dd49a21020434ff838fc308626c48cd8f05': raise RuntimeError('Unexpected SLJIT submodule revision')
    cmake=(src/'CMakeLists.txt').read_text()
    files=source_list(cmake,'scemu_core')+source_list(cmake,'scemu')
    # Native JIT cannot run in wasm32. SLJIT's unsupported-platform implementation is compiled, H8500 JIT excluded.
    # If upstream requires an unavailable JIT primitive, fail at compile/link rather than fall back to a different synth.
    run('emcc',*FLAGS,'-std=c11','-DSLJIT_CONFIG_UNSUPPORTED=1','-DSLJIT_CONFIG_AUTO=0','-DSLJIT_DEBUG=0','-DSLJIT_VERBOSE=0','-DSCEMU_SP_ONE_SHOT_MUTE=1',f'-DMODEL_ID={model}', '-I'+str(src/'src'),'-I'+str(sljit),ROOT/'native/profiles/roland_sc.c',*[src/f for f in files],sljit/'sljitLir.c','-lm','-o',out)
    return (src/'LICENSE').read_text()+'\n\nSLJIT source: https://github.com/zherczeg/sljit/tree/'+actual+'\n'+(sljit.parent/'LICENSE').read_text()

def cqm(cache,tmp,out):
    src=checkout('86box',cache)
    # Remove the PC/ISA device wrapper and retain the exact pinned synthesis code.
    c=(src/'src/sound/snd_cqm_nuked.c').read_text()
    h=(src/'src/include/86box/snd_cqm_nuked.h').read_text()
    cut='#define CQM_CLOCK'
    if c.count(cut)!=1 or h.count('} cqm_t;')!=1 or h.count('void CQM_Reset(')!=1: raise RuntimeError('Unexpected CQM source')
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
    return 'Nuked CQM by Alexey Khokholov and Miran Grca, LGPL-2.1-or-later (source: 86Box pinned above).\n'+(A/'LICENSE.LGPL-2.1.txt').read_text()+'\n'+(A/'LICENSE.GPL-3.txt').read_text()

def mt32(cache,tmp,out):
    src=checkout('munt',cache); project=tmp/'munt-cmake'; project.mkdir()
    # Build a static libmt32emu using its own pinned CMake source lists and generated headers.
    (project/'CMakeLists.txt').write_text('''cmake_minimum_required(VERSION 3.16)
project(defuss_mt32 LANGUAGES C CXX)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(libmt32emu_SHARED OFF CACHE BOOL "" FORCE)
set(libmt32emu_BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)
set(libmt32emu_WITH_VERSION_TAGGING OFF CACHE BOOL "" FORCE)
set(libmt32emu_WITH_SYMBOL_VERSIONING OFF CACHE BOOL "" FORCE)
set(libmt32emu_INSTALL_DEFAULT_LOCALE OFF CACHE BOOL "" FORCE)
set(libmt32emu_C_INTERFACE ON CACHE BOOL "" FORCE)
add_subdirectory("${MUNT_SOURCE}/mt32emu" munt)
add_executable(roland_mt32 "${BRIDGE}")
target_include_directories(roland_mt32 PRIVATE "${MUNT_SOURCE}/mt32emu/src" "${CMAKE_BINARY_DIR}/munt" "${CMAKE_BINARY_DIR}/munt/src")
target_link_libraries(roland_mt32 PRIVATE mt32emu)
set_target_properties(roland_mt32 PROPERTIES SUFFIX ".wasm")
'''+ 'target_link_options(roland_mt32 PRIVATE '+ ' '.join('"'+f.replace('"','\\"')+'"' for f in FLAGS)+')\n')
    build=tmp/'munt-build'
    run('emcmake','cmake','-S',project,'-B',build,'-DCMAKE_BUILD_TYPE=Release',f'-DMUNT_SOURCE={src}',f'-DBRIDGE={ROOT/"native/profiles/roland_mt32.cpp"}')
    run('cmake','--build',build,'--target','roland_mt32','--parallel')
    shutil.copy2(build/'roland_mt32.wasm',out)
    return (src/'mt32emu/COPYING.LESSER.txt').read_text()+'\n'+(src/'mt32emu/COPYING.txt').read_text()

def awe(cache,tmp,model,out):
    src=checkout('awe32emu',cache)/'AWE32Emu/src'
    # The driver's license is not yet declared; don't redistribute this local source or binary.
    work=tmp/'awe'; shutil.copytree(src,work)
    def rewrite(file, pattern, replacement):
        path=work/file; text=path.read_text(); text,n=re.subn(pattern,lambda _:replacement,text,flags=re.S)
        if n!=1: raise RuntimeError(f'Unexpected AWE32Emu source {file}: {n} matches')
        path.write_text(text)
    for file,variable,stream,error in [('Synth.cpp','raw','f','error = "Missing ROM"; return false;'),('SoundFont.cpp','buf','file','bank.errorMessage = "Missing bank"; return bank;')]:
        rewrite(file,r'std::ifstream '+stream+r'\(path, std::ios::binary\);.*?std::vector<uint8_t> '+variable+r'\(\(std::istreambuf_iterator<char>\('+stream+r'\)\),\s*std::istreambuf_iterator<char>\(\)\);',
            f'extern std::vector<uint8_t> defuss_awe_read(const std::string&);\n    auto {variable}=::defuss_awe_read(path);\n    if ({variable}.empty()) {{ {error} }}')
    # SoundFont::Load belongs to namespace SoundFont; declare the global function at file scope.
    for file in ['Synth.cpp','SoundFont.cpp']:
        p=work/file; t=p.read_text(); t=t.replace('extern std::vector<uint8_t> defuss_awe_read(const std::string&);\n    ',''); t=t.replace('#include <fstream>','#include <fstream>\nextern std::vector<uint8_t> defuss_awe_read(const std::string&);');p.write_text(t)
    rewrite('Emu8000Box.cpp',r'if \(FILE\* f = std::fopen\(g_romPath, "rb"\)\).*?std::memset\(&m_impl->emu, 0, sizeof\(m_impl->emu\)\);','std::memset(&m_impl->emu, 0, sizeof(m_impl->emu));')
    rewrite('86box/snd_emu8k.c',r'fp = rom_fopen\(EMU8K_ROM_PATH, "rb"\);.*?fclose\(fp\);','extern size_t defuss_awe_rom_copy(void *,size_t);\n    emu8k->rom = calloc(1024,1024);\n    if (!emu8k->rom || defuss_awe_rom_copy(emu8k->rom,1048576)<1048574) fatal("Missing AWE ROM\\n");')
    # Use actual measured 86Box EMU8000 core; no PC bus, DOS/Win95 VM, or host filesystem.
    inc=['-I'+str(work),'-I'+str(work/'86box/include'),'-DAWE32EMU_WITH_86BOX',f'-DMODEL_ID={model}','-DNDEBUG','-O2','-fwrapv']
    obj=tmp/'emu8k.o'; run('emcc',*inc,'-c',work/'86box/snd_emu8k.c','-o',obj)
    files=[work/x for x in ['Synth.cpp','Emu8000.cpp','Emu8000Box.cpp','SoundFont.cpp','I18n.cpp']]
    run('em++',*FLAGS,*inc,'-std=c++17','-fno-exceptions',ROOT/'native/profiles/awe.cpp',*files,obj,'-o',out)
    return 'LOCAL BUILD ONLY. AWE32Emu driver license undecided. EMU8000 chip GPL-2.0-or-later. See pinned upstream README and 86Box source notices.\n'

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
    for cmd in ['emcc','emcmake','cmake','node','git']:
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
