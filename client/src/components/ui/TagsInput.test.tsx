import { describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { afterEach } from 'vitest';
import { TagsInput } from './TagsInput';

afterEach(cleanup);

describe('<TagsInput>', () => {
  it('commits a tag on Enter and clears the draft', () => {
    const onChange = vi.fn();
    render(<TagsInput value={[]} onChange={onChange} />);
    const input = screen.getByPlaceholderText('Add a tag…');
    fireEvent.change(input, { target: { value: 'Travel' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(['travel']);
  });

  it('normalises the same way the server does: lowercase, # stripped, deduplicated', () => {
    const onChange = vi.fn();
    render(<TagsInput value={['travel']} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: '#Travel' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Already present after normalisation — must not be added twice.
    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits on comma and on blur, not just Enter', () => {
    const onChange = vi.fn();
    const { rerender } = render(<TagsInput value={[]} onChange={onChange} />);
    const input = screen.getByRole('textbox');
    // keydown fires before the comma character would be appended to the value.
    fireEvent.change(input, { target: { value: 'family' } });
    fireEvent.keyDown(input, { key: ',' });
    expect(onChange).toHaveBeenCalledWith(['family']);

    onChange.mockClear();
    rerender(<TagsInput value={['family']} onChange={onChange} />);
    fireEvent.change(input, { target: { value: 'office' } });
    fireEvent.blur(input);
    expect(onChange).toHaveBeenCalledWith(['family', 'office']);
  });

  it('removes the last tag on Backspace when the draft is empty', () => {
    const onChange = vi.fn();
    render(<TagsInput value={['a', 'b']} onChange={onChange} />);
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Backspace' });
    expect(onChange).toHaveBeenCalledWith(['a']);
  });

  it('removes a specific tag via its remove button', () => {
    const onChange = vi.fn();
    render(<TagsInput value={['a', 'b', 'c']} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText('Remove tag b'));
    expect(onChange).toHaveBeenCalledWith(['a', 'c']);
  });

  it('refuses a 21st tag', () => {
    const onChange = vi.fn();
    const twenty = Array.from({ length: 20 }, (_, i) => `t${i}`);
    render(<TagsInput value={twenty} onChange={onChange} />);
    expect(screen.getByRole('textbox')).toBeDisabled();
  });
});
