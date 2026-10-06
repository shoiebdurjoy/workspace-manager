import {
  Briefcase,
  Building2,
  Camera,
  Clapperboard,
  Film,
  Folder,
  Globe,
  Layers,
  Megaphone,
  Music,
  Palette,
  PenTool,
  Rocket,
  Sparkles,
  Star,
  Tv,
  Users,
  Video,
  type LucideIcon,
} from 'lucide-react';

/** The icons a Space can use. The stored value is the key (validated by a database CHECK). */
export const SPACE_ICONS: Record<string, LucideIcon> = {
  folder: Folder,
  briefcase: Briefcase,
  video: Video,
  film: Film,
  clapperboard: Clapperboard,
  camera: Camera,
  megaphone: Megaphone,
  palette: Palette,
  'pen-tool': PenTool,
  layers: Layers,
  star: Star,
  rocket: Rocket,
  users: Users,
  'building-2': Building2,
  tv: Tv,
  music: Music,
  globe: Globe,
  sparkles: Sparkles,
};

export const SPACE_ICON_KEYS = Object.keys(SPACE_ICONS);

export function iconFor(key: string | null | undefined): LucideIcon {
  return (key && SPACE_ICONS[key]) || Folder;
}
