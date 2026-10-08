import {
  AirVent, AlarmSmoke, Anchor, Building2, CableCar, Car, Castle, Coffee, CookingPot, Crown, Dumbbell, Fence, Flame,
  Flower2, Heater, Home, KeyRound, Landmark, Laptop, Mountain, MountainSnow, PawPrint, Sailboat, Sparkles, Tent,
  TreePalm, TreePine, Trees, Tv, Waves, WavesLadder, WashingMachine, Wheat, Wifi, type LucideIcon,
} from "lucide-react";

export const CATEGORY_ICONS: Record<string, LucideIcon> = {
  Trending: Flame,
  Beachfront: Waves,
  "Amazing views": Mountain,
  Cabins: TreePine,
  "Amazing pools": WavesLadder,
  Countryside: Wheat,
  Lakefront: Sailboat,
  Castles: Castle,
  "Tiny homes": Home,
  Treehouses: Trees,
  Mansions: Crown,
  Tropical: TreePalm,
  Camping: Tent,
  "Historical homes": Landmark,
  Skiing: CableCar,
  "Iconic cities": Building2,
};

export const AMENITY_ICONS: Record<string, LucideIcon> = {
  wifi: Wifi,
  kitchen: CookingPot,
  parking: Car,
  pool: WavesLadder,
  ac: AirVent,
  washer: WashingMachine,
  workspace: Laptop,
  tv: Tv,
  hottub: Waves,
  fireplace: Flame,
  beach: TreePalm,
  mountain: MountainSnow,
  grill: Fence,
  gym: Dumbbell,
  pets: PawPrint,
  key: KeyRound,
  breakfast: Coffee,
  heating: Heater,
  garden: Flower2,
  alarm: AlarmSmoke,
  lake: Anchor,
  ski: CableCar,
};

export const amenityIcon = (key: string): LucideIcon => AMENITY_ICONS[key] ?? Sparkles;
export const categoryIcon = (name: string): LucideIcon => CATEGORY_ICONS[name] ?? Sparkles;
