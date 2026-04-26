// soundfontEngine.js
// Loads GM soundfonts from gleitz/midi-js-soundfonts (FluidR3) and schedules
// notes entirely in Web Audio — no IAC Driver or external MIDI device needed.

const SF_PERCUSSION = -1; // sentinel for GM channel 9 (drums)

const SF_CDN = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM';

// State (Truth Layer) - Soundfont Engine -----
// Cache: program → Map<midiPitch, AudioBuffer>
const _sfCache   = new Map();
const _sfLoading = new Map(); // in-flight promises

// Helpers (Pure Computation Layer) - Soundfont Engine -----

const _SF_PROGRAM_NAMES = [
  'acoustic_grand_piano','bright_acoustic_piano','electric_grand_piano','honky_tonk_piano',
  'electric_piano_1','electric_piano_2','harpsichord','clavinet',
  'celesta','glockenspiel','music_box','vibraphone',
  'marimba','xylophone','tubular_bells','dulcimer',
  'drawbar_organ','percussive_organ','rock_organ','church_organ',
  'reed_organ','accordion','harmonica','tango_accordion',
  'acoustic_guitar_nylon','acoustic_guitar_steel','electric_guitar_jazz','electric_guitar_clean',
  'electric_guitar_muted','overdriven_guitar','distortion_guitar','guitar_harmonics',
  'acoustic_bass','electric_bass_finger','electric_bass_pick','fretless_bass',
  'slap_bass_1','slap_bass_2','synth_bass_1','synth_bass_2',
  'violin','viola','cello','contrabass',
  'tremolo_strings','pizzicato_strings','orchestral_harp','timpani',
  'string_ensemble_1','string_ensemble_2','synth_strings_1','synth_strings_2',
  'choir_aahs','voice_oohs','synth_choir','orchestra_hit',
  'trumpet','trombone','tuba','muted_trumpet',
  'french_horn','brass_section','synth_brass_1','synth_brass_2',
  'soprano_sax','alto_sax','tenor_sax','baritone_sax',
  'oboe','english_horn','bassoon','clarinet',
  'piccolo','flute','recorder','pan_flute',
  'blown_bottle','shakuhachi','whistle','ocarina',
  'lead_1_square','lead_2_sawtooth','lead_3_calliope','lead_4_chiff',
  'lead_5_charang','lead_6_voice','lead_7_fifths','lead_8_bass_plus_lead',
  'pad_1_new_age','pad_2_warm','pad_3_polysynth','pad_4_choir',
  'pad_5_bowed','pad_6_metallic','pad_7_halo','pad_8_sweep',
  'fx_1_rain','fx_2_soundtrack','fx_3_crystal','fx_4_atmosphere',
  'fx_5_brightness','fx_6_goblins','fx_7_echoes','fx_8_sci_fi',
  'sitar','banjo','shamisen','koto',
  'kalimba','bag_pipe','fiddle','shanai',
  'tinkle_bell','agogo','steel_drums','woodblock',
  'taiko_drum','melodic_tom','synth_drum','reverse_cymbal',
  'guitar_fret_noise','breath_noise','seashore','bird_tweet',
  'telephone_ring','helicopter','applause','gunshot',
];

// GM drum pitch → gleitz percussion soundfont key name
const _SF_DRUM_NAMES = {
  35:'Acoustic_Bass_Drum', 36:'Bass_Drum_1',     37:'Side_Stick',
  38:'Acoustic_Snare',     39:'Hand_Clap',        40:'Electric_Snare',
  41:'Low_Floor_Tom',      42:'Closed_Hi_Hat',    43:'High_Floor_Tom',
  44:'Pedal_Hi_Hat',       45:'Low_Tom',          46:'Open_Hi_Hat',
  47:'Low_Mid_Tom',        48:'High_Mid_Tom',     49:'Crash_Cymbal_1',
  50:'High_Tom',           51:'Ride_Cymbal_1',    52:'Chinese_Cymbal',
  53:'Ride_Bell',          54:'Tambourine',       55:'Splash_Cymbal',
  56:'Cowbell',            57:'Crash_Cymbal_2',   58:'Vibraslap',
  59:'Ride_Cymbal_2',      60:'High_Bongo',       61:'Low_Bongo',
  62:'Mute_Hi_Conga',      63:'Open_Hi_Conga',    64:'Low_Conga',
  65:'High_Timbale',       66:'Low_Timbale',      67:'High_Agogo',
  68:'Low_Agogo',          69:'Cabasa',           70:'Maracas',
  71:'Short_Whistle',      72:'Long_Whistle',     73:'Short_Guiro',
  74:'Long_Guiro',         75:'Claves',           76:'Hi_Wood_Block',
  77:'Low_Wood_Block',     78:'Mute_Cuica',       79:'Open_Cuica',
  80:'Mute_Triangle',      81:'Open_Triangle',
};

// Converts a gleitz melodic note name ("C4", "Bb3", "F#5") to MIDI pitch
function _sfNoteNameToMidi(name) {
  const semis = { C:0, D:2, E:4, F:5, G:7, A:9, B:11 };
  const m = name.match(/^([A-G])([b#]?)(-?\d+)$/);
  if (!m) return null;
  let midi = (parseInt(m[3]) + 1) * 12 + semis[m[1]];
  if (m[2] === '#') midi++;
  if (m[2] === 'b') midi--;
  return (midi >= 0 && midi <= 127) ? midi : null;
}

function _sfClosestPitch(noteMap, target) {
  if (noteMap.has(target)) return target;
  let best = null, bestDist = Infinity;
  for (const p of noteMap.keys()) {
    const d = Math.abs(p - target);
    if (d < bestDist) { bestDist = d; best = p; }
  }
  return best;
}

async function _sfLoadScript(name) {
  if (window.MIDI?.Soundfont?.[name]) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = `${SF_CDN}/${name}-mp3.js`;
    s.onload = res;
    s.onerror = () => rej(new Error(`Soundfont load failed: ${name}`));
    document.head.appendChild(s);
  });
}

async function _sfDecodeAll(soundfontObj, keyToMidi) {
  const ctx     = getAudioContext();
  const noteMap = new Map();
  await Promise.all(Object.entries(soundfontObj).map(async ([key, dataUri]) => {
    const pitch = keyToMidi(key);
    if (pitch === null || pitch === undefined) return;
    try {
      // Use atob instead of fetch() — fetch of data: URIs is restricted in some
      // Chrome/Safari contexts and fails silently.
      const base64  = dataUri.split(',')[1];
      const binary  = atob(base64);
      const bytes   = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const buf = await ctx.decodeAudioData(bytes.buffer);
      noteMap.set(pitch, buf);
    } catch { /* skip undecodable sample */ }
  }));
  return noteMap;
}

// Authority (Meaning Layer) - Soundfont Engine -----

async function sfEnsureProgram(program) {
  if (_sfCache.has(program)) return;
  if (_sfLoading.has(program)) { await _sfLoading.get(program); return; }

  const promise = (async () => {
    if (program === SF_PERCUSSION) {
      await _sfLoadScript('percussion');
      const sf = window.MIDI?.Soundfont?.percussion;
      if (!sf) throw new Error('Percussion soundfont not found');
      // Invert _SF_DRUM_NAMES: gleitz key → MIDI pitch
      const nameToMidi = Object.fromEntries(
        Object.entries(_SF_DRUM_NAMES).map(([pitch, name]) => [name, parseInt(pitch)])
      );
      _sfCache.set(program, await _sfDecodeAll(sf, k => nameToMidi[k] ?? null));
    } else {
      const name = _SF_PROGRAM_NAMES[program] ?? 'acoustic_grand_piano';
      await _sfLoadScript(name);
      const sf = window.MIDI?.Soundfont?.[name];
      if (!sf) throw new Error(`Soundfont not found: ${name}`);
      _sfCache.set(program, await _sfDecodeAll(sf, _sfNoteNameToMidi));
    }
  })();

  _sfLoading.set(program, promise);
  try   { await promise; }
  catch { _sfCache.set(program, new Map()); } // cache empty map so we don't retry on every play
  finally { _sfLoading.delete(program); }
}

// Projection/Rendering (View Layer) - Soundfont Engine -----

function sfScheduleNote(dest, program, pitch, velocity, audioTime, durationSec) {
  const noteMap = _sfCache.get(program);
  if (!noteMap) return [];

  const srcPitch = _sfClosestPitch(noteMap, pitch);
  if (srcPitch === null) return [];

  const ctx = getAudioContext();

  const src  = ctx.createBufferSource();
  src.buffer = noteMap.get(srcPitch);
  src.detune.value = (pitch - srcPitch) * 100; // cents

  const gain = ctx.createGain();
  const vol  = (velocity / 127) * 0.9;
  gain.gain.setValueAtTime(vol, audioTime);
  gain.gain.setTargetAtTime(0, audioTime + durationSec, 0.08);

  src.connect(gain);
  gain.connect(dest ?? ctx.destination);

  src.start(audioTime);
  src.stop(audioTime + durationSec + 0.5);

  return [src];
}
