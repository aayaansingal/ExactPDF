import { render } from 'preact';
import { Popup } from './Popup.js';

const root = document.getElementById('root');
if (root !== null) {
  render(<Popup />, root);
}
