import './styles/main.css';

import { BoxNetModel } from './model/BoxNetModel.js';
import {
  EDGES,
  FACE_BY_NORMAL,
  OPPOSITE_EDGE,
  getAdjacentBasis,
  rectanglesOverlap,
} from './model/geometry.js';
import { createBoxNetApp } from './ui/app.js';

const model = new BoxNetModel({ width: 150, height: 90, depth: 40 });

window.BoxNet = {
  BoxNetModel,
  EDGES,
  OPPOSITE_EDGE,
  FACE_BY_NORMAL,
  getAdjacentBasis,
  rectanglesOverlap,
};

window.boxNetApp = createBoxNetApp({ model });

export { model };
