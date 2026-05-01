// sf2Parser.js — SoundFont 2 binary parser
// Returns Map<program, Map<rootMidiPitch, {buffer, loops, loopStart, loopEnd}>>
// program === SF_PERCUSSION (-1) for bank 128 (GM drums)

async function sf2Parse(arrayBuffer, audioCtx) {
  const dv = new DataView(arrayBuffer);
  const u8 = new Uint8Array(arrayBuffer);

  const cc4 = o => String.fromCharCode(u8[o], u8[o+1], u8[o+2], u8[o+3]);
  const str = (o, n) => { let s = ''; for (let i = 0; i < n && u8[o+i]; i++) s += String.fromCharCode(u8[o+i]); return s; };

  if (cc4(0) !== 'RIFF' || cc4(8) !== 'sfbk') throw new Error('Not a valid SF2 file');

  // Walk RIFF/LIST chunks, returning a flat map of id or "LIST:type" → {start, end}
  function walkChunks(start, end) {
    const m = {};
    for (let p = start; p + 8 <= end;) {
      const id   = cc4(p);
      const size = dv.getUint32(p + 4, true);
      if (id === 'LIST') {
        const type = cc4(p + 8);
        m['LIST:' + type] = { start: p + 12, end: p + 8 + size };
      } else {
        m[id] = { start: p + 8, end: p + 8 + size };
      }
      p += 8 + size + (size & 1);
    }
    return m;
  }

  const top  = walkChunks(12, 8 + dv.getUint32(4, true));
  const sdta = top['LIST:sdta'] ? walkChunks(top['LIST:sdta'].start, top['LIST:sdta'].end) : {};
  const pdta = top['LIST:pdta'] ? walkChunks(top['LIST:pdta'].start, top['LIST:pdta'].end) : {};

  if (!sdta.smpl) throw new Error('SF2: no smpl chunk');
  if (!pdta.phdr || !pdta.pbag || !pdta.pgen || !pdta.inst || !pdta.ibag || !pdta.igen || !pdta.shdr)
    throw new Error('SF2: missing pdta chunks');

  // Parse fixed-size record arrays
  function records(chunk, recSize, parse) {
    const a = [];
    for (let o = chunk.start; o + recSize <= chunk.end; o += recSize) a.push(parse(o));
    return a;
  }

  const phdr = records(pdta.phdr, 38, o => ({
    preset: dv.getUint16(o + 20, true),
    bank:   dv.getUint16(o + 22, true),
    bagNdx: dv.getUint16(o + 24, true),
  }));
  const pbag = records(pdta.pbag,  4, o => ({ genNdx: dv.getUint16(o, true) }));
  const pgen = records(pdta.pgen,  4, o => ({ oper: dv.getUint16(o, true), lo: u8[o+2], hi: u8[o+3] }));
  const inst = records(pdta.inst, 22, o => ({ bagNdx: dv.getUint16(o + 20, true) }));
  const ibag = records(pdta.ibag,  4, o => ({ genNdx: dv.getUint16(o, true) }));
  const igen = records(pdta.igen,  4, o => ({ oper: dv.getUint16(o, true), lo: u8[o+2], hi: u8[o+3] }));
  const shdr = records(pdta.shdr, 46, o => ({
    name:       str(o, 20),
    start:      dv.getUint32(o + 20, true),
    end:        dv.getUint32(o + 24, true),
    startloop:  dv.getUint32(o + 28, true),
    endloop:    dv.getUint32(o + 32, true),
    sampleRate: dv.getUint32(o + 36, true),
    pitch:      u8[o + 40],
    sampleType: dv.getUint16(o + 44, true), // 1=mono 2=right 4=left 0x8000=ROM
  }));

  // Lazily decode PCM samples into AudioBuffers
  const smplStart = sdta.smpl.start;
  const _bufs = new Map();
  async function decodeSample(idx) {
    if (_bufs.has(idx)) return _bufs.get(idx);
    const h = shdr[idx];
    if (!h || h.end <= h.start || (h.sampleType & 0x8000)) return null;
    const n  = h.end - h.start;
    const ab = audioCtx.createBuffer(1, n, h.sampleRate);
    const ch = ab.getChannelData(0);
    const base = smplStart + h.start * 2;
    for (let i = 0; i < n; i++) ch[i] = dv.getInt16(base + i * 2, true) / 32768;
    _bufs.set(idx, ab);
    return ab;
  }

  // Collect generators for one bag into an object keyed by oper
  function iGens(bagIdx) {
    const start = ibag[bagIdx].genNdx;
    const end   = ibag[bagIdx + 1]?.genNdx ?? igen.length;
    const g = {};
    for (let i = start; i < end; i++) g[igen[i].oper] = igen[i];
    return g;
  }
  function pGens(bagIdx) {
    const start = pbag[bagIdx].genNdx;
    const end   = pbag[bagIdx + 1]?.genNdx ?? pgen.length;
    const g = {};
    for (let i = start; i < end; i++) g[pgen[i].oper] = pgen[i];
    return g;
  }

  // SF2 generator operator codes used here
  const GEN_KEYRANGE     = 43;
  const GEN_INSTRUMENT   = 41;
  const GEN_SAMPLEID     = 53;
  const GEN_SAMPLEMODES  = 54;
  const GEN_OVERRIDEROOT = 58;

  const result = new Map(); // program → Map<rootPitch, {buffer, loops, loopStart, loopEnd, name?}>

  for (let pi = 0; pi < phdr.length - 1; pi++) {
    const p = phdr[pi];
    if (p.bank !== 0 && p.bank !== 128) continue;
    const program = p.bank === 128 ? SF_PERCUSSION : p.preset;

    const noteMap  = new Map();
    const bagEnd   = phdr[pi + 1].bagNdx;

    for (let b = p.bagNdx; b < bagEnd; b++) {
      const pG = pGens(b);
      if (!(GEN_INSTRUMENT in pG)) continue;
      const instIdx = pG[GEN_INSTRUMENT].lo | (pG[GEN_INSTRUMENT].hi << 8);
      if (instIdx >= inst.length - 1) continue;

      const ins    = inst[instIdx];
      const iBagEnd = inst[instIdx + 1].bagNdx;

      // Global zone: first instrument bag with no sampleID generator
      let globalG = {};
      if (!(GEN_SAMPLEID in iGens(ins.bagNdx))) globalG = iGens(ins.bagNdx);

      for (let ib = ins.bagNdx; ib < iBagEnd; ib++) {
        const zG = { ...globalG, ...iGens(ib) };
        if (!(GEN_SAMPLEID in zG)) continue;

        const sIdx = zG[GEN_SAMPLEID].lo | (zG[GEN_SAMPLEID].hi << 8);
        const h    = shdr[sIdx];
        if (!h) continue;

        const rootPitch = (GEN_OVERRIDEROOT in zG && zG[GEN_OVERRIDEROOT].lo !== 255)
          ? zG[GEN_OVERRIDEROOT].lo
          : h.pitch;

        const modes = (GEN_SAMPLEMODES in zG) ? (zG[GEN_SAMPLEMODES].lo & 3) : 0;
        const loops = (modes & 1) !== 0;
        const buf   = await decodeSample(sIdx);
        if (!buf) continue;

        if (!noteMap.has(rootPitch)) {
          noteMap.set(rootPitch, {
            buffer:    buf,
            loops,
            loopStart: loops ? (h.startloop - h.start) / h.sampleRate : 0,
            loopEnd:   loops ? (h.endloop   - h.start) / h.sampleRate : 0,
            name:      program === SF_PERCUSSION ? h.name : undefined,
          });
        }
      }
    }

    if (noteMap.size > 0) result.set(program, noteMap);
  }

  // Human-readable summary
  // console.group('[sf2] Loaded soundfont');
  // const melodic = [...result.keys()].filter(k => k !== SF_PERCUSSION).sort((a, b) => a - b);
  // const percMap  = result.get(SF_PERCUSSION);
  // const percNameCount = percMap ? [...percMap.values()].filter(e => e.name).length : 0;
  // console.log(`Programs (melodic): ${melodic.length}  |  Percussion notes named: ${percNameCount}`);
  // if (melodic.length) {
  //   console.groupCollapsed('Melodic programs');
  //   for (const prog of melodic) {
  //     console.log(`  Program ${String(prog).padStart(3)}: ${result.get(prog).size} samples`);
  //   }
  //   console.groupEnd();
  // }
  // if (percMap?.size) {
  //   console.groupCollapsed('Percussion note names (by rootPitch)');
  //   const sorted = [...percMap.entries()].sort(([a], [b]) => a - b);
  //   for (const [pitch, entry] of sorted) {
  //     console.log(`  ${String(pitch).padStart(3)}: ${entry.name ?? '(unnamed)'}`);
  //   }
  //   console.groupEnd();
  // }
  // console.groupEnd();

  return result;
}
