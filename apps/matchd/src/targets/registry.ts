import { dcGcc } from "./dcGcc.js"
import { saturnGcc } from "./saturnGcc.js"
import { genesisGcc } from "./genesisGcc.js"
import { dsGcc } from "./dsGcc.js"
import { n3dsGcc } from "./n3dsGcc.js"
import { gamecubeMwcc } from "./gamecubeMwcc.js"
import { gbaAgbcc } from "./gbaAgbcc.js"
import { hostGcc } from "./hostGcc.js"
import { msvcX64 } from "./msvcX64.js"
import { n64Gcc } from "./n64Gcc.js"
import { ps1Gcc } from "./ps1Gcc.js"
import { ps2Gcc } from "./ps2Gcc.js"
import { pspGcc } from "./pspGcc.js"
import { ps3Gcc } from "./ps3Gcc.js"
import { ps4Clang } from "./ps4Clang.js"
import { switchClang } from "./switchClang.js"
import { wiiuGcc } from "./wiiuGcc.js"
import { xboxI386 } from "./xboxI386.js"
import type { MatchTarget } from "./types.js"

/**
 * Images this matchd process knows how to compile.
 * The binary has to be installed for the job to succeed.
 * See Dockerfile.agbcc, Dockerfile.n64, Dockerfile.mwcc, Dockerfile.coff,
 * Dockerfile.switch, Dockerfile.ds, Dockerfile.3ds, Dockerfile.dc, Dockerfile.saturn, Dockerfile.genesis, Dockerfile.ps1, Dockerfile.ps2, Dockerfile.psp, Dockerfile.ps3, Dockerfile.ps4, Dockerfile.xbox, and Dockerfile.wiiu.
 */
export const matchTargets: ReadonlyArray<MatchTarget> = [
  hostGcc,
  gbaAgbcc,
  dsGcc,
  n3dsGcc,
  dcGcc,
  saturnGcc,
  genesisGcc,
  n64Gcc,
  gamecubeMwcc,
  msvcX64,
  switchClang,
  ps1Gcc,
  ps2Gcc,
  pspGcc,
  ps3Gcc,
  ps4Clang,
  xboxI386,
  wiiuGcc
]

export const resolveTarget = (image: string): MatchTarget | undefined =>
  matchTargets.find((target) => target.images.includes(image))
