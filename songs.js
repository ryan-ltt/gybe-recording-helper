// ─── Canonical songs, albums, and setlist normalization ────────────────────
// Shared by the main page and the profile page. Loaded before index.js.

// ─── Canonical songs ───────────────────────────────────────────────────────
const CANONICAL_SONGS = [
    '12-28-99', '12-28-99 (outro)', '2 nouveau tower', '3rd part', 'albanian', 'anthem for no state',
    'babys in a thundercloud', 'behemoth', 'blaise bailey finnegan III', 'bosses hang',
    'broken spires at dead kapital', 'chart #3', 'cliff', 'dead metheny',
    'divorce & fever', 'do you know how to waltz', 'fire at static valley', 'gamelan',
    'gathering storm', 'glacier', 'improvisation', 'intro', 'j.l.h. outro', 'john hughes', 'kicking horse on broken hill',
    "macrimmon's lament", 'monheim', 'motherfucker = redeemer', 'moya',
    'nothings alrite in our lives', 'pale spectator takes photographs', 'piss crowns are trebled',
    'raindrops cast in lead', 'sad mafioso', 'steve reich', 'sun is a hole sun is vapors',
    'tazer floyd', 'the cowboy', 'the dead flag blues', 'the dead flag blues (outro)',
    'world police',
];

// ─── Albums ────────────────────────────────────────────────────────────────
const ALBUMS = [
    { name: 'f#a#∞',                        year: '1997', songs: ['the dead flag blues', 'the cowboy', 'the dead flag blues (outro)', 'nothings alrite in our lives', 'sad mafioso', 'divorce & fever', 'dead metheny', 'kicking horse on broken hill', 'j.l.h. outro'] },
    { name: 'slow riot for new zerø kanada', year: '1999', songs: ['moya', 'blaise bailey finnegan III'] },
    { name: 'lift your skinny fists',        year: '2000', songs: ['gathering storm', 'chart #3', 'world police', 'monheim', '3rd part', 'john hughes'] },
    { name: 'yanqui u.x.o.',                 year: '2002', songs: ['12-28-99', '12-28-99 (outro)', 'tazer floyd', 'motherfucker = redeemer'] },
    { name: "allelujah! don't bend! ascend!",year: '2012', songs: ['albanian', 'gamelan'] },
    { name: 'asunder, sweet and other distress', year: '2015', songs: ['behemoth', 'piss crowns are trebled'] },
    { name: 'luciferian towers',             year: '2017', songs: ['bosses hang', '2 nouveau tower', 'anthem for no state' ] },
    { name: "g_d's pee at state's end!",     year: '2021', songs: ['glacier', 'fire at static valley', 'cliff' ] },
    { name: 'no title as of 13 february 2024 28,340 dead', year: '2024', songs: ['sun is a hole sun is vapors', 'babys in a thundercloud', 'raindrops cast in lead', 'broken spires at dead kapital', 'pale spectator takes photographs'] },
];


// ─── Normalization ─────────────────────────────────────────────────────────
function normalizeSong(raw) {
    const s = raw.toLowerCase()
        .replace(/\s+thanks to\b.*/g, '')
        .replace(/\s+\[.*/g, '')
        .replace(/\s+note\s*:.*/g, '')
        .replace(/\s+(order not confirmed|only the confirmed|unconfirmed).*/g, '')
        .replace(/\s+".*/g, '')
        .replace(/\(soundcheck\)|\(tape\)/g, '')
        .replace(/\s*\(w\/[^)]+\)/g, '')
        .replace(/\s*\(aborted\)/g, '')
        .replace(/\s*\(\?\)/g, '')
        .replace(/motherfucking/g, 'motherfucker')
        .replace(/motherfucker=redeemer/, 'motherfucker = redeemer')
        .trim();

    const MAP = {
        '12-28-99': '12-28-99', '12-28-99 (outro)': '12-28-99 (outro)', '12-28-99 (w/ outro)': '12-28-99',
        '12-28-99 (w/outro)': '12-28-99', '12-28-99 w/ outro': '12-28-99', '11-28-99 w/ outro': '12-28-99',
        '12.28.99': '12-28-99', '12.28.99 (w/ outro)': '12-28-99', '12/28/99 (w/ outro)': '12-28-99',
        'impro + 12-28-99': '12-28-99', '09-15-00': '12-28-99', '09-15-00 (cont.)': '12-28-99',
        'intro': 'intro', 'hope drone': 'intro', 'the dead flag blues (intro version)': 'intro',
        'improvisation': 'improvisation', 'improv': 'improvisation', 'impro': 'improvisation',
        'improvised': 'improvisation', 'improvisation/impro': 'improvisation',
        '2 nouveau tower': '2 nouveau tower', 'fam/famine': '2 nouveau tower', 'fam/famine -> undoing a luciferian towers': '2 nouveau tower',
        '3rd part': '3rd part', 'broken windows, locks of love part iii': '3rd part', 'new thing (part 3)': '3rd part',
        'albanian': 'albanian', 'mladic': 'albanian',
        'anthem for no state': 'anthem for no state', 'anthem for no state (part 1)': 'anthem for no state', 'new new': 'anthem for no state', 'railroads': 'anthem for no state',
        'babys in a thundercloud': 'babys in a thundercloud',
        'behemoth': 'behemoth', 'behemoth (part 2)': 'behemoth', "big'un": 'behemoth',
        'blaise bailey finnegan iii': 'blaise bailey finnegan III',
        'blaise bailey finnegan ii': 'blaise bailey finnegan III',
        'blaise bailey finnegan iiii': 'blaise bailey finnegan III',
        'bbf3': 'blaise bailey finnegan III',
        'bosses hang': 'bosses hang', 'bosses hang (section)': 'bosses hang', '[bosses hang ?]': 'bosses hang', 'old new': 'bosses hang', 'buildings': 'bosses hang',
        'broken spires at dead kapital': 'broken spires at dead kapital',
        'chart #3': 'chart #3', 'chart #3/steve reich': 'chart #3',
        'steve reich': 'steve reich',
        'cliff': 'cliff',
        'dead flag blues': 'the dead flag blues', 'dead flag blues (outro)': 'the dead flag blues (outro)',
        'dead metheny': 'dead metheny', 'dead metheny (w/ outro)': 'dead metheny', 'death metheny': 'dead metheny',
        'divorce & fever': 'divorce & fever',
        'do you know how to waltz': 'do you know how to waltz',
        'fire at static valley': 'fire at static valley', 'fire at static vallley': 'fire at static valley',
        '(?) fire at static valley': 'fire at static valley',
        'gamelan': 'gamelan', 'we drift like worried fire': 'gamelan',
        'gathering storm': 'gathering storm', 'gathering storm (part 2)': 'gathering storm',
        'gathering storm (part ii)': 'gathering storm', 'gathering storm pt. i': 'gathering storm',
        'gatheering storm': 'gathering storm', 'gathering strom': 'gathering storm', 'gatherng storm': 'gathering storm',
        'storm': 'gathering storm', 'new thing': 'gathering storm', 'lift yr. skinny fists like antennas to heaven': 'gathering storm', "therry's": 'gathering storm',
        'glacier': 'glacier', 'glaicer': 'glacier',
        'j.l.h. outro': 'j.l.h. outro', 'j.l.h outro': 'j.l.h. outro', 'j.l.h. (outro)': 'j.l.h. outro',
        'j.l.h. outro jam': 'j.l.h. outro', 'intro -> j.l.h. outro': 'j.l.h. outro', 'john lee hooker outro': 'j.l.h. outro',
        'john hughes': 'john hughes', 'she dreamt she was a bulldozer, she dreamt she was alone in an empty field': 'john hughes',
        'kicking horse on broken hill': 'kicking horse on broken hill', 'kicking horses on brokenhill': 'kicking horse on broken hill', 'bolero': 'kicking horse on broken hill',
        "macrimmon's lament": "macrimmon's lament",
        'monheim': 'monheim', 'monhiem': 'monheim', 'intro + monheim': 'monheim',
        'motherfucker = redeemer': 'motherfucker = redeemer', 'tiny silver hammers': 'motherfucker = redeemer',
        'moya': 'moya', 'moya (?)': 'moya', 'moya (aborted)': 'moya', 'gorecki': 'moya',
        'nothings alrite in our life': 'nothings alrite in our lives', 'nothings alrite in our lives': 'nothings alrite in our lives',
        'pale spectator takes photographs': 'pale spectator takes photographs',
        'piss crowns are trebled': 'piss crowns are trebled',
        'raindrops cast in lead': 'raindrops cast in lead',
        'sad mafioso': 'sad mafioso', 'sad mafioso (part 2)': 'sad mafioso',
        'the sad mafioso': 'sad mafioso', 'the sad mafioso + outro': 'sad mafioso', 'the sad mafiosos': 'sad mafioso',
        'sun is a hole': 'sun is a hole sun is vapors', 'sun is a hole sun is vapors': 'sun is a hole sun is vapors', 'sun is a hole / sun is vapors': 'sun is a hole sun is vapors',
        'tazer floyd': 'tazer floyd', 'rockets fall on rocket falls': 'tazer floyd',
        'the boy': 'the cowboy', 'the cowboy': 'the cowboy', 'slow moving trains': 'the cowboy',
        'the dead flag blues': 'the dead flag blues',
        'the dead flag blues (outro)': 'the dead flag blues (outro)',
        'the dead flag blues outro': 'the dead flag blues (outro)', '(?)the dead flag blues (outro)': 'the dead flag blues (outro)',
        'world police': 'world police', 'wold police': 'world police', 'world police (part i)': 'world police',
        'world police and friendly fire': 'world police', "norsola's thing": 'world police',
    };
    return MAP[s] || null;
}
