# Font Attributions (public/fonts/)

Both typefaces ship binary woff2 files locally — no network fetch at render time.

| File | Typeface | License | Source |
| --- | --- | --- | --- |
| archivo-black-latin-400-normal.woff2 | Archivo Black (400) | SIL Open Font License 1.1 | Omnibus-Type via @fontsource/archivo-black |
| inter-latin-400-normal.woff2 | Inter (400) | SIL Open Font License 1.1 | Rasmus Andersson via @fontsource/inter |
| inter-latin-700-normal.woff2 | Inter (700) | SIL Open Font License 1.1 | @fontsource/inter |
| inter-latin-800-normal.woff2 | Inter (800) | SIL Open Font License 1.1 | @fontsource/inter |

SIL OFL 1.1 permits use, redistribution and bundling with software; reserve the
name "Archivo Black"/"Inter" only for the original fonts. The copy pipeline is:

    node_modules/@fontsource/<font>/files/<file>.woff2  →  public/fonts/

Upgrade weights by copying more files from the @fontsource packages and loading
them in src/whatif/theme.ts (loadFont with the matching weight).
