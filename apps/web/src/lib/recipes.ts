import type { SourceLanguage } from "@/lib/api"

export type SystemRecipe = {
  readonly system: string
  readonly compiler: string
  readonly image: string
  readonly cOnly: boolean
}

export const systemRecipes: ReadonlyArray<SystemRecipe> = [
  { system: "Nintendo 64", compiler: "mips-linux-gnu-gcc", image: "ghcr.io/re-hydra/n64-gcc:2.8.1", cOnly: true },
  { system: "Game Boy Advance", compiler: "agbcc-cc", image: "ghcr.io/re-hydra/agbcc:gba", cOnly: true },
  { system: "Nintendo DS", compiler: "arm-none-eabi-gcc", image: "ghcr.io/re-hydra/ds-gcc:arm", cOnly: false },
  { system: "Nintendo 3DS", compiler: "3ds-gcc", image: "ghcr.io/re-hydra/3ds-gcc:arm", cOnly: false },
  { system: "GameCube and Wii", compiler: "mwcc-cc", image: "ghcr.io/re-hydra/mwcc:gc", cOnly: false },
  { system: "Wii U", compiler: "powerpc-linux-gnu-gcc", image: "ghcr.io/re-hydra/wiiu-gcc:powerpc", cOnly: false },
  { system: "Switch", compiler: "switch-clang", image: "ghcr.io/re-hydra/clang:switch", cOnly: false },
  { system: "PlayStation", compiler: "mipsel-linux-gnu-gcc", image: "ghcr.io/re-hydra/ps1-gcc:mipsel", cOnly: false },
  { system: "PlayStation 2", compiler: "ps2-gcc", image: "ghcr.io/re-hydra/ps2-gcc:mips64el", cOnly: false },
  { system: "PlayStation 3", compiler: "powerpc64-linux-gnu-gcc", image: "ghcr.io/re-hydra/ps3-gcc:powerpc64", cOnly: false },
  { system: "PlayStation 4", compiler: "ps4-clang", image: "ghcr.io/re-hydra/clang:ps4", cOnly: false },
  { system: "PSP", compiler: "psp-gcc", image: "ghcr.io/re-hydra/psp-gcc:allegrex", cOnly: false },
  { system: "Windows (64-bit)", compiler: "coff-clang", image: "ghcr.io/re-hydra/clang:msvc-x64", cOnly: false },
  { system: "Windows (32-bit) and Xbox", compiler: "xbox-clang", image: "ghcr.io/re-hydra/clang:xbox", cOnly: false },
  { system: "Xbox One and Series", compiler: "coff-clang", image: "ghcr.io/re-hydra/clang:msvc-x64", cOnly: false },
  { system: "Dreamcast", compiler: "dc-gcc", image: "ghcr.io/re-hydra/dc-gcc:sh4", cOnly: false },
  { system: "Saturn", compiler: "saturn-gcc", image: "ghcr.io/re-hydra/saturn-gcc:sh2", cOnly: true },
  { system: "Genesis / Mega Drive", compiler: "genesis-gcc", image: "ghcr.io/re-hydra/genesis-gcc:68000", cOnly: false }
]

export const recipeBySystem = (system: string): SystemRecipe =>
  systemRecipes.find((row) => row.system === system) ?? systemRecipes[0]!

export const imageTag = (image: string): string => {
  const index = image.lastIndexOf(":")
  return index === -1 ? image : image.slice(index + 1)
}

export const driverFor = (compiler: string, language: SourceLanguage): string =>
  language === "cpp" && compiler.endsWith("gcc") ? `${compiler.slice(0, -3)}g++` : compiler
