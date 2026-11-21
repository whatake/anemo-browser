export interface PaletteAction {
  id: string
  label: string
  keywords?: string
  hint?: string
  run: () => void | Promise<void>
}
