WebGL 1 texture styles must skip the WebGL 2-only texture comparison state.
PixiJS applies this guard to both CommonJS and ES module distributions
to prevent `INVALID_ENUM` errors. Verify WebGL 1 compatibility when updating PixiJS.

`GlTextureSystem` also never re-creates a destroyed texture source: `bind` swaps in
`Texture.EMPTY`, `getGlSource` hands back the empty texture's GPU data for any other path
(render targets, unbind, text uploads), and `updateStyle` skips a source whose style is
gone. Destroyed sources have a null style, which crashed `applyStyleParams`
(Sentry THENINJARPG-359, "reading 'addressModeU'").
