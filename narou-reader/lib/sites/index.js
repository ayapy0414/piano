import narou from './narou.js';
import kakuyomu from './kakuyomu.js';
import hameln from './hameln.js';
import aozora from './aozora.js';
import generic from './generic.js';

// 先に書いたものから順に判定する。generic は最後（何にでもマッチする）。
export const sites = [narou, kakuyomu, hameln, aozora, generic];

export function findSite(url) {
  const u = new URL(url);
  return { site: sites.find((s) => s.match(u)), u };
}

export const getSite = (id) => sites.find((s) => s.id === id);
