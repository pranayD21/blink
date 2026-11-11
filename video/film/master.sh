#!/bin/bash
CH="[0:a]highpass=f=85,equalizer=f=220:t=q:w=1:g=-1.5,equalizer=f=3600:t=q:w=1.2:g=2.5,acompressor=threshold=-22dB:ratio=3:attack=6:release=120:makeup=4,aformat=channel_layouts=stereo,volume=1.2[v];[1:a]volume=0.9[m];[v][m]amix=inputs=2:normalize=0:duration=longest,alimiter=limit=0.89:level=false"
J=$(ffmpeg -hide_banner -i vo.wav -i music.wav -filter_complex "$CH,loudnorm=I=-15:TP=-1.2:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
g() { echo "$J" | python3 -c "import sys,json;print(json.load(sys.stdin)['$1'])"; }
ffmpeg -v error -y -i vo.wav -i music.wav -filter_complex "$CH,loudnorm=I=-15:TP=-1.2:LRA=11:measured_I=$(g input_i):measured_TP=$(g input_tp):measured_LRA=$(g input_lra):measured_thresh=$(g input_thresh):offset=$(g target_offset):linear=true,aresample=48000[o]" -map "[o]" -c:a pcm_s16le master.wav
ffmpeg -hide_banner -i master.wav -af ebur128=peak=true:framelog=quiet -f null - 2>&1 | grep -E ' I:| LRA:| Peak:' 
