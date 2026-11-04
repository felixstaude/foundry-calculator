import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { App } from '../src/App';

describe('App shell', () => {
  it('renders the title and the build commit', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Foundry Calculator' })).toBeInTheDocument();
    expect(screen.getByTestId('commit')).toHaveTextContent('test');
  });
});
