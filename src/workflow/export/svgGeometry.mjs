/**
 * Pure SVG path geometry helpers for the incremental M4 source extraction.
 *
 * These helpers deliberately know nothing about the DOM or the CartonBuilder
 * namespace. The browser renderer can consume the same functions after the
 * generated-engine parity gate proves that the release artifact is unchanged.
 */

export function arcFlags(segment) {
  const startAngle = Math.atan2(segment.start.y - segment.center.y, segment.start.x - segment.center.x);
  const endAngle = Math.atan2(segment.end.y - segment.center.y, segment.end.x - segment.center.x);
  let delta = endAngle - startAngle;
  while (delta <= -Math.PI * 2)
    delta += Math.PI * 2;
  while (delta > Math.PI * 2)
    delta -= Math.PI * 2;
  if (segment.clockwise) {
    if (delta > 0)
      delta -= Math.PI * 2;
  } else if (delta < 0) {
    delta += Math.PI * 2;
  }
  return { largeArc: Math.abs(delta) > Math.PI ? 1 : 0, sweep: segment.clockwise ? 0 : 1 };
}

function projectedPoint(point, sy, project) {
  const screenPoint = { x: Number(point.x), y: sy(Number(point.y)) };
  return project ? project(screenPoint) : screenPoint;
}

export function contourPath(contour, sy, project = null, determinant = 1) {
  if (!contour.segments.length)
    return "";
  const first = projectedPoint(contour.segments[0].start, sy, project);
  let path = `M ${first.x.toFixed(4)} ${first.y.toFixed(4)}`;
  for (const segment of contour.segments) {
    const end = projectedPoint(segment.end, sy, project);
    if (segment.kind === "LINE")
      path += ` L ${end.x.toFixed(4)} ${end.y.toFixed(4)}`;
    else if (segment.kind === "ARC") {
      const flags = arcFlags(segment);
      const baseSweep = flags.sweep ? 0 : 1;
      const sweep = determinant < 0 ? 1 - baseSweep : baseSweep;
      path += ` A ${segment.radius.toFixed(4)} ${segment.radius.toFixed(4)} 0 ${flags.largeArc} ${sweep} ${end.x.toFixed(4)} ${end.y.toFixed(4)}`;
    } else {
      const control1 = projectedPoint(segment.control1, sy, project);
      const control2 = projectedPoint(segment.control2, sy, project);
      path += ` C ${control1.x.toFixed(4)} ${control1.y.toFixed(4)} ${control2.x.toFixed(4)} ${control2.y.toFixed(4)} ${end.x.toFixed(4)} ${end.y.toFixed(4)}`;
    }
  }
  if (contour.closed)
    path += " Z";
  return path;
}

export function segmentPath(segment, sy, project = null, determinant = 1) {
  const start = projectedPoint(segment.start, sy, project);
  const end = projectedPoint(segment.end, sy, project);
  if (segment.kind === "LINE")
    return `M ${start.x.toFixed(4)} ${start.y.toFixed(4)} L ${end.x.toFixed(4)} ${end.y.toFixed(4)}`;
  if (segment.kind === "ARC") {
    const flags = arcFlags(segment);
    const baseSweep = flags.sweep ? 0 : 1;
    const sweep = determinant < 0 ? 1 - baseSweep : baseSweep;
    return `M ${start.x.toFixed(4)} ${start.y.toFixed(4)} A ${segment.radius.toFixed(4)} ${segment.radius.toFixed(4)} 0 ${flags.largeArc} ${sweep} ${end.x.toFixed(4)} ${end.y.toFixed(4)}`;
  }
  const control1 = projectedPoint(segment.control1, sy, project);
  const control2 = projectedPoint(segment.control2, sy, project);
  return `M ${start.x.toFixed(4)} ${start.y.toFixed(4)} C ${control1.x.toFixed(4)} ${control1.y.toFixed(4)} ${control2.x.toFixed(4)} ${control2.y.toFixed(4)} ${end.x.toFixed(4)} ${end.y.toFixed(4)}`;
}
