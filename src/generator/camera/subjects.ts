/**
 * src/generator/camera/subjects.ts — what the camera can frame in each kit.
 *
 * The director names a subject per shot from this list; each stage implements
 * the same names as anchors (position and size at a moment, see
 * src/compositions/camera/ShotCamera.tsx). Every kit also has "scene": the
 * whole set, for establishing shots and as the fallback when a name is unknown.
 */
export const KIT_SUBJECTS: Record<string, Record<string, string>> = {

  "street-block": {
    scene: "the whole street, both rows of buildings",
    hero: "the story's object on the sidewalk (coin stacks, cash, a sign...)",
    cafe: "the café terrace: tables, umbrellas, people sitting",
    traffic: "the cars in the near lane",
    walker: "a pedestrian on the sidewalk",
    crosswalk: "the crosswalk close to the camera",
    skyline: "the tops of the buildings against the sky",
  },
  ocean: {
    scene: "the beach and the sea",
    sea: "the open water out to the horizon",
    beach: "the sand, umbrellas and towels",
    jetty: "the wooden jetty",
    canoe: "a canoe floating by the jetty",
    horizon: "the horizon line and the sky",
  },
  space: {
    scene: "the planet in space",
    planet: "the planet itself (earth, moon or mars)",
    surface: "a close view of the planet's surface",
    stars: "the star field",
  },
  forest: {
    scene: "the forest",
    tree: "one big tree near the camera",
    canopy: "the treetops",
    path: "the forest floor and path",
    light: "a shaft of light through the trees",
  },
  countryside: {
    scene: "the fields, farm and hills",
    house: "a farmhouse",
    barn: "the barn",
    windmill: "the windmill",
    fields: "the crop fields",
    road: "the dirt road",
    hills: "the mountain ridge on the horizon",
  },
  river: {
    scene: "the river valley",
    river: "the flowing water",
    waterfall: "the waterfall",
    rocks: "the rocks in the river",
  },
  interior: {
    scene: "the whole room",
    window: "the window and its light",
    sofa: "the sofa",
    lamp: "the floor lamp",
    table: "the table",
    person: "the person in the room",
  },
  world: {
    scene: "the whole place from across the avenue or above",
    avenue: "the main avenue and its walkers",
    plaza: "the city's main square (when the place has one)",
    park: "the park inside the city (when it has one)",
    landmark: "the place's landmark (a minaret, tower...)",
  },
};

/** Subject names a kit offers ("scene" for kits not listed). */
export function subjectsFor(kit: string | undefined): string[] {
  return Object.keys(KIT_SUBJECTS[kit ?? ""] ?? { scene: "" });
}

/** The prompt lines the director reads for one kit. */
export function subjectMenu(kit: string): string {
  const subs = KIT_SUBJECTS[kit] ?? { scene: "the whole set" };
  return Object.entries(subs)
    .map(([name, what]) => `${name} = ${what}`)
    .join("; ");
}
