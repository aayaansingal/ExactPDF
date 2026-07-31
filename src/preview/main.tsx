import { render } from 'preact';
import { Preview } from './Preview.js';

const root = document.getElementById('root');
if (root !== null) {
  render(<Preview />, root);
}
