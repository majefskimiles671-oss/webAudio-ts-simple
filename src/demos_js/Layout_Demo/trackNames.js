// trackNames.js
// Helpers - Track Name Generator - Static Data -----

const TRACK_NAMES_STARS = [
  "Vega", "Lyra", "Altair", "Rigel", "Deneb", "Sirius", "Spica",
  "Antares", "Aldebaran", "Capella", "Procyon", "Castor", "Pollux",
  "Fomalhaut", "Canopus", "Achernar", "Alioth", "Mizar", "Alkaid",
  "Thuban", "Eltanin", "Kochab", "Schedar", "Caph", "Pulsar",
  "Quasar", "Nebula", "Zenith", "Umbra", "Corona", "Solstice",
  "Equinox", "Perihelion", "Aphelion", "Liminal", "Penumbra",
];

const TRACK_NAMES_FLOWERS = [
  "Aster", "Dahlia", "Iris", "Lotus", "Peony", "Violet", "Jasmine",
  "Zinnia", "Poppy", "Larkspur", "Verbena", "Foxglove", "Wisteria",
  "Azalea", "Camellia", "Magnolia", "Narcissus", "Hyacinth", "Lavender",
  "Salvia", "Amaranth", "Yarrow", "Hellebore", "Clematis", "Anemone",
  "Cosmos", "Delphinium", "Freesia", "Hibiscus", "Lupin", "Primrose",
  "Trillium", "Allium", "Borage", "Celosia", "Gentian", "Heliotrope",
];

const TRACK_NAMES_WEATHER = [
  { name: "Squall",        definition: "A sudden violent gust of wind, often with rain or sleet." },
  { name: "Mistral",       definition: "A cold, dry, strong northwesterly wind from France to the Mediterranean." },
  { name: "Sirocco",       definition: "A hot, dry, dust-laden wind blowing north from the Sahara." },
  { name: "Zephyr",        definition: "A soft, gentle westerly breeze." },
  { name: "Föhn",          definition: "A warm, dry wind descending on the lee side of a mountain range." },
  { name: "Bora",          definition: "A cold, violent northeasterly wind along the Adriatic coast." },
  { name: "Chinook",       definition: "A warm, dry wind descending the eastern slopes of the Rockies." },
  { name: "Haboob",        definition: "A violent dust storm driven by collapsing thunderstorm outflow." },
  { name: "Tramontane",    definition: "A cold, dry wind blowing south over the mountains of France and Spain." },
  { name: "Levanter",      definition: "A humid easterly wind funneled through the Strait of Gibraltar." },
  { name: "Solano",        definition: "A hot, humid, sand-laden southeast wind on Spain's Andalusian coast." },
  { name: "Harmattan",     definition: "A dry, dusty northeasterly trade wind blowing across West Africa." },
  { name: "Gregale",       definition: "A strong northeast wind in the central Mediterranean." },
  { name: "Etesian",       definition: "A steady, dry northerly wind that blows across the Aegean each summer." },
  { name: "Shamal",        definition: "A dry northwesterly wind blowing over Iraq and the Persian Gulf." },
  { name: "Mizzle",        definition: "A drizzle so fine it exists halfway between mist and rain." },
  { name: "Virga",         definition: "Precipitation that evaporates completely before reaching the ground." },
  { name: "Graupel",       definition: "Soft, fragile pellets of rime-coated snow." },
  { name: "Whiteout",      definition: "A blizzard so dense that sky and snow merge into uniform white." },
  { name: "Pampero",       definition: "A sudden, cold southwesterly wind sweeping across the Pampas." },
  { name: "Leste",         definition: "A hot, dry easterly wind that blows off the Canary Islands." },
  { name: "Khamsin",       definition: "A hot, dusty southerly wind that blows across Egypt for fifty days." },
  { name: "Libeccio",      definition: "A strong southwest wind over the central and western Mediterranean." },
  { name: "Norther",       definition: "A strong cold northerly wind in the southern United States and Gulf of Mexico." },
  { name: "Williwaw",      definition: "A sudden violent squall blowing through the Strait of Magellan." },
  { name: "Sundowner",     definition: "A hot, dry offshore wind that arrives at sunset near Santa Barbara." },
  { name: "Diablo",        definition: "A hot, dry offshore wind in the San Francisco Bay Area." },
  { name: "Coromell",      definition: "A cool, refreshing night breeze in La Paz, Baja California." },
  { name: "Tehuantepecer", definition: "A violent gap wind funneled through the Isthmus of Tehuantepec." },
  { name: "Papagayo",      definition: "A strong, gusty northerly gap wind along the Pacific coast of Central America." },
  { name: "Chubasco",      definition: "A violent tropical squall on the Pacific coast of Mexico and Central America." },
  { name: "Breva",         definition: "A cool valley breeze that rises from the lake in Catalonia, Spain." },
  { name: "Vendaval",      definition: "A strong westerly gale near the Strait of Gibraltar, often bringing heavy rain." },
  { name: "Abroholos",     definition: "A violent squall with sudden wind shifts off the coast of Brazil." },
  { name: "Friagem",       definition: "A cold front that plunges temperatures sharply into tropical Brazil." },
  { name: "Suestada",      definition: "A southeast storm wind driving a surge into the Río de la Plata estuary." },
  { name: "Minuano",       definition: "A cold southerly wind that sweeps through southern Brazil and Uruguay." },
];

const TRACK_NAMES_MUSIC = [
  "Fermata", "Coda", "Aria", "Fugue", "Étude", "Nocturne", "Caprice", "Impromptu",
  "Cadenza", "Ostinato", "Rubato", "Tremolo", "Glissando", "Portamento", "Toccata", "Scherzo",
  "Rhapsody", "Fantasia", "Passacaglia", "Chaconne", "Barcarolle", "Berceuse", "Tarantella", "Bolero",
  "Pavane", "Gavotte", "Gigue", "Mazurka", "Polonaise", "Serenade", "Cantata", "Concerto",
  "Prelude", "Interlude", "Cadence", "Rondo",
];

const TRACK_NAMES_NAMES = [
  "Yuki", "Hana", "Sora", "Ren",
  "Layla", "Zara", "Amir", "Tariq",
  "Amara", "Kofi", "Zuri", "Kwame",
  "Lola", "Paloma", "Diego", "Luna",
  "Astrid", "Sigrid", "Freya", "Leif",
  "Priya", "Arjun", "Kavya", "Rohan",
  "Mila", "Zoya", "Sasha", "Lena",
  "Mei", "Lin", "Jing", "Wei",
  "Niamh", "Aoife", "Ciarán", "Brigid",
];

const TRACK_NAMES_CITIES = [
  "Kyoto", "Lagos", "Havana", "Oslo",
  "Dubrovnik", "Reykjavik", "Marrakech", "Tbilisi",
  "Cartagena", "Nairobi", "Kathmandu", "Zanzibar",
  "Lisbon", "Seville", "Porto", "Gdańsk",
  "Ljubljana", "Tallinn", "Kotor", "Mostar",
  "Muscat", "Hoi An", "Chiang Mai", "Baku",
  "Vilnius", "Riga", "Valletta", "Tangier",
  "Oaxaca", "Medellín", "Banff", "Salzburg",
  "Tromsø", "Plovdiv", "Yerevan", "Essaouira",
];

const TRACK_NAMES_VERBS = [
  "visits", "dreams of", "returns to", "escapes to", "wanders",
  "left", "misses", "calls from", "arrived in", "vanished in",
  "wrote from", "waits in", "fell asleep in", "got lost in", "passed through",
  "never reached", "sings of", "hides in", "longs for", "remembered",
  "forgot", "ran to", "moved to", "belongs in", "hears",
  "recorded in", "slept through", "photographed",
];

const TRACK_NAMES_NAMES_IN_CITIES = (() => {
  const names  = [...TRACK_NAMES_NAMES].sort(() => Math.random() - 0.5);
  const verbs = [...TRACK_NAMES_VERBS].sort(() => Math.random() - 0.5);
  const cities = [...TRACK_NAMES_CITIES].sort(() => Math.random() - 0.5);
  return names.map((name, i) => `${name} ${verbs[i]??"in"} ${cities[i]}`);
})();

const TRACK_NAMES = TRACK_NAMES_NAMES_IN_CITIES;
