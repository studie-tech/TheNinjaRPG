import { atom } from "jotai";

/**
 * Character images of every quest dialog scene on screen, one entry per mounted
 * scene, so the tutorial lesson can leave out a speaker the page already shows.
 */
export const sceneCharactersAtom = atom<readonly (readonly string[])[]>([]);
