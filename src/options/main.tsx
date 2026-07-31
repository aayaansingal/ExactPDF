import { render } from 'preact';
import { Options } from './Options.js';

const root = document.getElementById('root');
if (root !== null) {
  render(<Options />, root);
}
