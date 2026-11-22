'use strict';

(() => {
  let context;
  const voices = new Map();
  function voice(kind) {
    const seconds = 4,
      buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
    const samples = buffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < samples.length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      samples[i] = kind === 'brown' ? last * 3.5 : white;
    }
    const noise = context.createBufferSource(),
      filter = context.createBiquadFilter(),
      gain = context.createGain();
    noise.buffer = buffer;
    noise.loop = true;
    filter.type = kind === 'cafe' ? 'bandpass' : kind === 'rain' ? 'highpass' : 'lowpass';
    filter.frequency.value = { cafe: 360, rain: 800, brown: 1100 }[kind];
    filter.Q.value = 0.5;
    gain.gain.value = 0;
    noise.connect(filter).connect(gain).connect(context.destination);
    noise.start();
    if (kind === 'cafe') {
      const wobble = context.createOscillator(),
        depth = context.createGain();
      wobble.frequency.value = 0.19;
      depth.gain.value = 110;
      wobble.connect(depth).connect(filter.frequency);
      wobble.start();
    }
    return gain;
  }
  for (const [kind, label] of [
    ['rain', 'Soft rain'],
    ['brown', 'Brown noise'],
    ['cafe', 'Café hum'],
  ]) {
    const row = document.createElement('label'),
      slider = document.createElement('input'),
      out = document.createElement('output');
    const name = document.createElement('span');
    name.textContent = label;
    slider.type = 'range';
    slider.min = 0;
    slider.max = 100;
    slider.value = 0;
    slider.setAttribute('aria-label', label + ' volume');
    out.textContent = '0%';
    slider.oninput = async () => {
      try {
        context ??= new (window.AudioContext || window.webkitAudioContext)();
        if (context.state !== 'running') await context.resume();
        if (!voices.has(kind)) voices.set(kind, voice(kind));
        voices
          .get(kind)
          .gain.setTargetAtTime((Number(slider.value) / 100) * 0.32, context.currentTime, 0.06);
        out.textContent = slider.value + '%';
        if ([...document.querySelectorAll('#sounds input')].every((i) => i.value === '0'))
          setTimeout(() => {
            if ([...document.querySelectorAll('#sounds input')].every((i) => i.value === '0'))
              context.suspend().catch(() => {});
          }, 300);
      } catch {
        document.getElementById('sound-status').textContent =
          'Audio is unavailable in this browser.';
      }
    };
    row.append(name, out, slider);
    document.getElementById('sounds').append(row);
  }
})();
