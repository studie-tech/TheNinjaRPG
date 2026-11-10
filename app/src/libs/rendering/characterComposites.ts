import {
  Container,
  Rectangle,
  type Renderer,
  RenderTexture,
  Sprite,
  Texture,
} from "pixi.js";
import { stabilizeNearestTexture } from "@/libs/rendering/assets";

/**
 * Shared atlas of composited LPC character frames, so a crowd draws one quad per actor from a
 * handful of textures instead of one quad per clothing layer from hundreds.
 *
 * Each actor keeps its layered rig offscreen and asks for the frame its rig currently shows,
 * keyed by the rig's layer textures. Frames already in the atlas are shared by every actor in
 * that pose; new ones are drawn by `flush` in one pass per page before the scene renders. Pages
 * are added on demand up to `maxPages`; after that the least recently shown frame no actor is
 * displaying is redrawn with the new pose.
 */
export const createCharacterComposites = (
  renderer: Renderer,
  options: { pageSize?: number; maxPages?: number } = {},
) => {
  const pageSize = options.pageSize ?? COMPOSITE_PAGE_SIZE;
  const maxPages = options.maxPages ?? COMPOSITE_MAX_PAGES;
  const columns = Math.floor(pageSize / COMPOSITE_CELL);
  const pages: RenderTexture[] = [];
  const free: CompositeCell[] = [];
  const byKey = new Map<string, CompositeCell>();
  /** Frames no actor displays, least recently shown first. */
  const idle = new Set<CompositeCell>();
  /** Each rig's latest requested pose, so a frame is only drawn from a rig still in that pose. */
  const rigKeys = new WeakMap<Container, string>();
  const pending = new Map<CompositeCell, Set<Container>>();
  const pass = new Container();
  const slots: { erase: Sprite; holder: Container }[] = [];
  let epoch = 0;
  let destroyed = false;

  const addPage = () => {
    if (pages.length >= maxPages) return false;
    const page = RenderTexture.create({
      width: pageSize,
      height: pageSize,
      resolution: 1,
      antialias: false,
      scaleMode: "nearest",
    });
    page.source.label = "character-composites";
    pages.push(page);
    const cells: CompositeCell[] = [];
    for (let row = 0; row < columns; row++)
      for (let column = 0; column < columns; column++) {
        const x = column * COMPOSITE_CELL,
          y = row * COMPOSITE_CELL;
        cells.push({
          page,
          x,
          y,
          key: null,
          users: 0,
          texture: stabilizeNearestTexture(
            new Texture({
              source: page.source,
              frame: new Rectangle(x, y, COMPOSITE_CELL, COMPOSITE_CELL),
            }),
          ),
        });
      }
    // Pop from the end so cells fill the page from its top-left corner.
    free.push(...cells.reverse());
    return true;
  };

  const unmap = (cell: CompositeCell) => {
    if (cell.key !== null && byKey.get(cell.key) === cell) byKey.delete(cell.key);
    cell.key = null;
    pending.delete(cell);
    if (!cell.users) {
      idle.delete(cell);
      free.push(cell);
    }
  };

  const allocate = () => {
    if (!free.length) addPage();
    const fresh = free.pop();
    if (fresh) return fresh;
    const oldest = idle.values().next().value;
    if (!oldest) return null;
    idle.delete(oldest);
    if (oldest.key !== null) byKey.delete(oldest.key);
    oldest.key = null;
    return oldest;
  };

  return {
    /** Incremented whenever every cell's content is lost; displayed frames must be requested again. */
    epoch: () => epoch,
    /**
     * The cell holding `key`, drawn from `rig` at the next flush when it is new. The caller
     * displays it until it releases it. Null when every cell is on screen.
     */
    acquire: (key: string, rig: Container) => {
      if (destroyed) return null;
      rigKeys.set(rig, key);
      let cell: CompositeCell | null | undefined = byKey.get(key);
      if (cell) {
        if (!cell.users++) idle.delete(cell);
        pending.get(cell)?.add(rig);
        return cell;
      }
      cell = allocate();
      if (!cell) return null;
      cell.key = key;
      cell.users = 1;
      byKey.set(key, cell);
      pending.set(cell, new Set([rig]));
      return cell;
    },
    release: (cell: CompositeCell) => {
      if (destroyed || cell.users <= 0) return;
      if (--cell.users) return;
      if (cell.key === null) {
        free.push(cell);
        return;
      }
      // Most recently shown frames are evicted last.
      idle.add(cell);
    },
    /** Draw this frame's new poses into their pages; rigs leave the pass afterwards. */
    flush: () => {
      if (destroyed || !pending.size) return;
      const byPage = new Map<RenderTexture, [CompositeCell, Container][]>();
      for (const [cell, rigs] of pending) {
        let source: Container | undefined;
        for (const rig of rigs)
          if (!rig.destroyed && rigKeys.get(rig) === cell.key) {
            source = rig;
            break;
          }
        if (!source) {
          // No rig still shows this pose; whoever displays the cell will request it again.
          pending.delete(cell);
          unmap(cell);
          continue;
        }
        const list = byPage.get(cell.page) ?? [];
        list.push([cell, source]);
        byPage.set(cell.page, list);
      }
      pending.clear();
      for (const [page, cells] of byPage) {
        // A rig appears once per pass; identical outfits in one frame share one cell already.
        const used = new Set<Container>();
        const holders: Container[] = [];
        let index = 0;
        for (const [cell, rig] of cells) {
          if (used.has(rig)) {
            unmap(cell);
            continue;
          }
          used.add(rig);
          let slot = slots[index];
          if (!slot) {
            const erase = new Sprite(Texture.WHITE);
            erase.blendMode = "erase";
            erase.width = COMPOSITE_CELL;
            erase.height = COMPOSITE_CELL;
            const holder = new Container();
            holder.scale.set(COMPOSITE_CELL);
            slot = { erase, holder };
            slots.push(slot);
          }
          index++;
          slot.erase.position.set(cell.x, cell.y);
          slot.holder.position.set(
            cell.x + COMPOSITE_CELL / 2,
            cell.y + COMPOSITE_CELL / 2,
          );
          pass.addChildAt(slot.erase, 0);
          pass.addChild(slot.holder);
          slot.holder.addChild(rig);
          holders.push(slot.holder);
        }
        renderer.render({ container: pass, target: page, clear: false });
        for (const holder of holders) holder.removeChildren();
        pass.removeChildren();
      }
    },
    /** After a lost context every page is blank again; displayed actors redraw on their next frame. */
    reset: () => {
      epoch++;
      for (const cell of [...byKey.values()]) unmap(cell);
      pending.clear();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      for (const slot of slots) {
        slot.holder.removeChildren();
        slot.erase.destroy();
        slot.holder.destroy();
      }
      pass.destroy();
      for (const page of pages) page.destroy(true);
      pages.length = 0;
      free.length = 0;
      byKey.clear();
      idle.clear();
      pending.clear();
    },
    /** Pages allocated so far and frames currently mapped, for diagnostics and tests. */
    stats: () => ({ pages: pages.length, frames: byKey.size, idle: idle.size }),
  };
};

export type CharacterComposites = ReturnType<typeof createCharacterComposites>;
export type CompositeCell = {
  page: RenderTexture;
  x: number;
  y: number;
  /** Pose drawn into this cell; null while unassigned. */
  key: string | null;
  /** Actors displaying this cell; only unused cells are redrawn. */
  users: number;
  texture: Texture;
};

/** LPC frames are 64 pixels square; composites keep that cell so poses swap in place. */
export const COMPOSITE_CELL = 64;
/** 4 MB pages hold 256 frames each (about two dozen walking characters); every WebGL device supports the size. */
export const COMPOSITE_PAGE_SIZE = 1024;
/** Eight pages hold every on-screen frame of a 100-player crowd within 32 MB. */
export const COMPOSITE_MAX_PAGES = 8;
