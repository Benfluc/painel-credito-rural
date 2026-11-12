import { feature } from "topojson-client";
import type { FeatureCollection, Geometry } from "geojson";
import type { Topology } from "topojson-specification";
import { useEffect, useState } from "react";

export interface PropsMun {
  id: string;
  name: string;
  uf: string;
}
export type FC<P> = FeatureCollection<Geometry, P>;
export type BBox = [number, number, number, number];

async function topo<P>(url: string): Promise<FC<P>> {
  const t = (await (await fetch(url)).json()) as Topology;
  const nome = Object.keys(t.objects)[0];
  return feature(t, t.objects[nome]) as unknown as FC<P>;
}

function bboxDe(geoms: Geometry[]): BBox {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  const visita = (c: unknown): void => {
    if (typeof (c as number[])[0] === "number") {
      const [x, y] = c as number[];
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
    } else (c as unknown[]).forEach(visita);
  };
  for (const g of geoms) if (g && "coordinates" in g) visita(g.coordinates);
  return [x0, y0, x1, y1];
}

export interface GeoBase {
  uf: FC<{ uf: string }>;
  mun: FC<PropsMun> | null;
  bboxUF: Map<string, BBox>;
  bboxMun: Map<string, BBox>;
  nomeMun: Map<string, string>;
}

export function useGeo(): GeoBase | null {
  const [g, setG] = useState<GeoBase | null>(null);
  useEffect(() => {
    let vivo = true;
    (async () => {
      const uf = await topo<{ uf: string }>("/geo/br-uf.topo.json");
      const bboxUF = new Map(uf.features.map((f) => [f.properties.uf, bboxDe([f.geometry])]));
      if (vivo) setG({ uf, mun: null, bboxUF, bboxMun: new Map(), nomeMun: new Map() });
      const mun = await topo<PropsMun>("/geo/br-mun.topo.json");
      const bboxMun = new Map(mun.features.map((f) => [f.properties.id, bboxDe([f.geometry])]));
      const nomeMun = new Map(mun.features.map((f) => [f.properties.id, f.properties.name]));
      if (vivo) setG({ uf, mun, bboxUF, bboxMun, nomeMun });
    })().catch(console.error);
    return () => {
      vivo = false;
    };
  }, []);
  return g;
}
