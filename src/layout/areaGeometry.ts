// Area geometry: the padded box each area draws, the title chip on its top
// border, and which edges each of them blocks. One computation feeds BOTH the
// routing obstacles and the rendered `AreaLayout`s, so routing avoids exactly
// what the user sees — the two can never drift. All rects are canvas pixels.

import type { Diagram } from '@/parser/ast'

import { areaMinWidth, areaTitleRect } from './areaTitle'
import type { AreaTree } from './areaTree'
import type { Rect } from './geometry'
import type { AreaLayout, LayoutSidecar } from './types'

// Padding between an area's outer border and its member nodes. Used for BOTH
// the rendered area box and the area-as-obstacle rect so routing avoids exactly
// what the user sees.
const AREA_PAD = 24

// Border-to-border padding between an area and a MEMBER AREA nested inside it.
// A plain AREA_PAD is too tight for nesting: both borders carry a title chip
// straddling them (each poking TITLE_HEIGHT/2 = 11px above its border), so at
// 24px the parent's and child's chips would sit ~2px apart. 48px leaves a
// clear lane between the chips and visually separates the two frames.
// Exported for tests.
export const NESTED_AREA_PAD = 48

// The area title chip pokes ABOVE the area's obstacle rect, so unless routing
// knows about it an edge skimming the top border draws straight over the title
// text — and "inside" edges skip the area rects entirely, so they cross it even
// more freely. Its geometry lives in ./areaTitle, shared with the renderer.
//
// Known limitation: the router has no textScale (it produces the canonical,
// scale-1 geometry the whole pipeline is built on — like edge-label and node-text
// avoidance, which are also scale-unaware). AreaLabel scales the chip by the live
// text zoom, so at a zoom other than 100% this obstacle no longer matches the
// rendered chip exactly. Acceptable: the committed/exported geometry is at scale 1.

// An area treated as a routing obstacle: the padded bounding box of its members
// plus the membership set. `members` holds the TRANSITIVE leaf-node ids —
// nested member areas are flattened down to the nodes they contain — so an
// area blocks an edge only when NEITHER endpoint lives anywhere inside it. An
// edge incident to a (transitive) member has to enter/leave the cluster, so
// membership exempts it from that area.
export type AreaObstacle = { id: string; rect: Rect; members: Set<string> }

export const areaBlocksEdge = (area: AreaObstacle, srcId: string, tgtId: string): boolean =>
  !area.members.has(srcId) && !area.members.has(tgtId)

export interface AreaGeometry {
  /** Padded box per area id; absent for an area with no resolvable members. */
  rects: Map<string, Rect>
  /** One obstacle per area that has a rect, in declaration order. */
  areaObstacles: AreaObstacle[]
  /** One obstacle per LABELLED area that has a rect: its title chip. The empty
   *  member set makes `areaBlocksEdge` true for every edge — unlike the area
   *  rect, a title must also be avoided by the member-incident "inside" edges
   *  (which skip the area rects). */
  titleObstacles: AreaObstacle[]
}

// Padded bounding box per area. Member areas are resolved CHILD-FIRST: a nested
// member contributes its own padded rect, inflated so the parent's border lands
// a full NESTED_AREA_PAD from the child's (title chips straddle both borders,
// so the plain AREA_PAD ring used for nodes would leave the two chips nearly
// touching). Areas with no resolvable members are skipped, and a parent skips
// an empty child the same way. The stack guard makes a membership cycle
// (rejected at parse time) terminate instead of recursing forever.
export const computeAreaGeometry = (
  diagram: Diagram,
  areaTree: AreaTree,
  nodes: Record<string, Rect>,
  layout: LayoutSidecar,
): AreaGeometry => {
  const areaRectById = new Map<string, Rect>()
  // Extra inflation for a member area's rect before unioning: the AREA_PAD
  // applied to the union below then puts the borders NESTED_AREA_PAD apart.
  const NEST_EXTRA = NESTED_AREA_PAD - AREA_PAD
  const computeAreaRect = (aid: string, stack: Set<string>): Rect | null => {
    const hit = areaRectById.get(aid)
    if (hit) return hit
    if (stack.has(aid)) return null
    stack.add(aid)
    const area = areaTree.byId.get(aid)!
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const mid of area.members) {
      let r: Rect | null
      if (areaTree.byId.has(mid)) {
        const child = computeAreaRect(mid, stack)
        r = child && {
          x: child.x - NEST_EXTRA,
          y: child.y - NEST_EXTRA,
          w: child.w + NEST_EXTRA * 2,
          h: child.h + NEST_EXTRA * 2,
        }
      } else {
        r = nodes[mid] ?? null
      }
      if (!r) continue
      minX = Math.min(minX, r.x)
      minY = Math.min(minY, r.y)
      maxX = Math.max(maxX, r.x + r.w)
      maxY = Math.max(maxY, r.y + r.h)
    }
    stack.delete(aid)
    if (!Number.isFinite(minX)) return null
    const rect: Rect = {
      x: minX - AREA_PAD,
      y: minY - AREA_PAD,
      w: maxX - minX + AREA_PAD * 2,
      h: maxY - minY + AREA_PAD * 2,
    }
    // A long title must never overhang the frame: widen the area until the chip
    // fits with an inset on both sides, growing AWAY from the title's alignment
    // (left keeps the left border, right keeps the right one, center grows both
    // ways) so the chosen alignment stays visible over the members.
    const minW = area.label ? areaMinWidth(area.label) : 0
    if (rect.w < minW) {
      const align = layout.areas?.[aid]?.labelAlign ?? 'center'
      const grow = minW - rect.w
      if (align === 'right') rect.x -= grow
      else if (align === 'center') rect.x -= grow / 2
      rect.w = minW
    }
    areaRectById.set(aid, rect)
    return rect
  }
  const areaObstacles: AreaObstacle[] = []
  for (const a of diagram.areas) {
    const rect = computeAreaRect(a.id, new Set())
    if (!rect) continue
    areaObstacles.push({
      id: a.id,
      rect,
      members: areaTree.leafNodesOf.get(a.id) ?? new Set(),
    })
  }

  // Only labelled areas with a resolvable rect get a title obstacle; a title
  // always coincides with an area that produced a rect above.
  const titleObstacles: AreaObstacle[] = []
  for (const a of diagram.areas) {
    if (!a.label) continue
    const rect = areaRectById.get(a.id)
    if (!rect) continue
    titleObstacles.push({
      id: a.id,
      rect: areaTitleRect(rect, a.label, layout.areas?.[a.id]?.labelAlign),
      members: new Set(),
    })
  }
  return { rects: areaRectById, areaObstacles, titleObstacles }
}

// The rendered areas, reusing the padded boxes computed for obstacle avoidance
// so the rendered area can never drift from the rect routing avoided. Areas are
// emitted PARENT-FIRST (shallower depth first, declaration order within a
// depth): both the canvas and the SSR export paint this array in order, so the
// sort IS the z-order — a nested area always draws on top of the container it
// sits in, and its fill/click surface is never buried.
export const layoutAreas = (
  diagram: Diagram,
  areaTree: AreaTree,
  rects: Map<string, Rect>,
  layout: LayoutSidecar,
): AreaLayout[] =>
  diagram.areas
    .map((a, declIndex) => ({ a, declIndex }))
    .sort(
      (x, y) =>
        (areaTree.depthOf.get(x.a.id) ?? 0) - (areaTree.depthOf.get(y.a.id) ?? 0) ||
        x.declIndex - y.declIndex,
    )
    .map(({ a }) => {
      const style = layout.areas?.[a.id]
      const rect = rects.get(a.id)
      if (!rect) {
        return { id: a.id, label: a.label, members: a.members, x: 0, y: 0, w: 0, h: 0, ...style }
      }
      return {
        id: a.id,
        label: a.label,
        members: a.members,
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        borderColor: style?.borderColor,
        borderStyle: style?.borderStyle,
        fillColor: style?.fillColor,
        labelAlign: style?.labelAlign,
      }
    })
