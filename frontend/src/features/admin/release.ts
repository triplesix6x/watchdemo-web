// What the publish form reads from a desktop build's file names. The installer and its
// .sig sit side by side in src-tauri/target/release/bundle/nsis, so one picker takes both.

export const TARGETS = ['windows', 'linux', 'darwin'] as const
export const ARCHS = ['x86_64', 'aarch64', 'i686', 'armv7'] as const

export const SEMVER = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/
const VERSION_IN_NAME = /[_-](\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)[_-]/

/** Version inside a Tauri bundle name: WatchDemo_0.8.0_x64-setup.exe -> 0.8.0. */
export function versionFromFileName(name: string): string | null {
  return VERSION_IN_NAME.exec(name)?.[1] ?? null
}

export const isSignatureFile = (name: string) => name.toLowerCase().endsWith('.sig')

/** Sorts picked files into the installer and the signature. A later pick replaces only
 *  the kind it contains. A pre-release version (with "-") suggests the beta channel. */
export function sortPicked(files: readonly File[]): { installer?: File; signature?: File; version?: string; beta?: boolean } {
  const out: ReturnType<typeof sortPicked> = {}
  for (const f of files) {
    if (isSignatureFile(f.name)) out.signature = f
    else {
      out.installer = f
      const v = versionFromFileName(f.name)
      out.version = v ?? undefined
      out.beta = v ? v.includes('-') : undefined
    }
  }
  return out
}
