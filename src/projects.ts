// Projects: CRUD against Supabase (row level security keeps each user to
// their own rows) plus the random naming scheme.

import { supabase } from './auth';

export interface ProjectRow {
  id: string;
  name: string;
  bpm: number;
  root_pc: number;
  scale: string;
  tracks: TrackSnapshot[];
  updated_at: string;
}

export interface TrackSnapshot {
  voiceIdx: number;
  muted: boolean;
  cells: number[];
}

// Names come from the microbial world — one word, sometimes two.
const CREATURES = [
  'Amoeba', 'Volvox', 'Paramecium', 'Euglena', 'Rotifer', 'Diatom',
  'Vorticella', 'Stentor', 'Spirogyra', 'Tardigrade', 'Chlorella',
  'Bacillus', 'Vibrio', 'Spirulina', 'Rhizopus', 'Micrococcus', 'Nostoc',
  'Anabaena', 'Daphnia', 'Ciliate', 'Archaea', 'Mycelium', 'Plankton',
  'Coccus', 'Protist', 'Desmid', 'Hydra', 'Copepod', 'Radiolaria',
  'Foraminifera', 'Streptococcus', 'Lactobacillus', 'Cyanobacteria',
  'Dinoflagellate', 'Choanoflagellate', 'Slime Mould', 'Blue Green',
];
const MODIFIERS = [
  'Motile', 'Wild', 'Blooming', 'Silent', 'Drifting', 'Warm', 'Deep',
  'Salt', 'Night', 'Split', 'Twin', 'Slow', 'Bright', 'Soft', 'Rogue',
];

export function randomName(): string {
  const creature = CREATURES[Math.floor(Math.random() * CREATURES.length)];
  if (Math.random() < 0.45) {
    const mod = MODIFIERS[Math.floor(Math.random() * MODIFIERS.length)];
    return `${mod} ${creature}`;
  }
  return creature;
}

export async function listProjects(): Promise<ProjectRow[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id, name, bpm, root_pc, scale, tracks, updated_at')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as ProjectRow[];
}

export async function createProject(
  snapshot: Omit<ProjectRow, 'id' | 'updated_at' | 'name'> & { name?: string }
): Promise<ProjectRow> {
  const { data: userData } = await supabase.auth.getUser();
  const userId = userData.user?.id;
  if (!userId) throw new Error('Not signed in');

  const { data, error } = await supabase
    .from('projects')
    .insert({
      user_id: userId,
      name: snapshot.name ?? randomName(),
      bpm: snapshot.bpm,
      root_pc: snapshot.root_pc,
      scale: snapshot.scale,
      tracks: snapshot.tracks,
    })
    .select('id, name, bpm, root_pc, scale, tracks, updated_at')
    .single();
  if (error) throw error;
  return data as ProjectRow;
}

export async function saveProject(
  id: string,
  patch: Partial<Omit<ProjectRow, 'id' | 'updated_at'>>
): Promise<void> {
  const { error } = await supabase.from('projects').update(patch).eq('id', id);
  if (error) throw error;
}

export async function renameProject(id: string, name: string): Promise<void> {
  await saveProject(id, { name });
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

/**
 * Autosave: coalesce a burst of edits into one write. Every change while
 * playing calls this; only the last one within the window hits the network.
 */
export function makeAutosave(delayMs = 1200) {
  let timer = 0;
  let pending: (() => Promise<void>) | null = null;
  let inFlight = false;

  const run = async () => {
    if (!pending || inFlight) return;
    const job = pending;
    pending = null;
    inFlight = true;
    try {
      await job();
    } catch {
      /* offline or a transient failure — the next edit will retry */
    } finally {
      inFlight = false;
      if (pending) run();
    }
  };

  return (job: () => Promise<void>) => {
    pending = job;
    clearTimeout(timer);
    timer = window.setTimeout(run, delayMs);
  };
}
