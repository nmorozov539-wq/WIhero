// The in-app changelog, shown in ☰ → Patch notes.
//
// Written for the people using WI Hero: what changed and where, in plain words, with no internal names, numbers or
// file paths. Add one entry at the top for every update, newest first, and keep the top version in step with
// manifest.json (test/changelog.test.js checks both). Group the lines by the place they affect.
export const CHANGELOG = [
    {
        version: '0.47.2',
        date: '2026-11-27',
        groups: [
            {
                title: 'Startup',
                items: [
                    'SillyTavern starts faster; the editor is ready when you first open it.',
                    'Opening the World Info drawer shows a short loading note instead of a silent wait.',
                ],
            },
            {
                title: 'Home, books and search',
                items: [
                    'Large books open and scroll without the long freeze.',
                    'Home, the book list and Hero keep their place, selection and focused row while you work.',
                    'Search answers sooner, without the wait while every book is read.',
                    'Only a few recently used books stay loaded; the book you are in is kept ready, and leaving Home stops it counting in the background.',
                ],
            },
            {
                title: 'Entry page',
                items: [
                    'Opening an entry is quick again, even in books with thousands of entries.',
                    'Typing in a long entry stays smooth, and the text box grows with the text.',
                    'Saving and undo stay responsive, and undo is kept within a sensible memory limit.',
                    'The token count updates without interrupting typing.',
                ],
            },
            {
                title: 'Hero',
                items: [
                    'Taps, scrolling and Show chat state no longer redraw the whole canvas.',
                    'Links, badges and card details update in place.',
                    'Opening Hero is faster, and closing it gives the memory back.',
                ],
            },
            {
                title: 'Motion',
                items: [
                    'Reduced motion is respected everywhere.',
                    'A hidden tab stops animating and drawing the canvas, then catches up when you return.',
                ],
            },
            {
                title: 'Known',
                items: [
                    'Hero can still stutter on weak phones when it opens, when a card is tapped or when the wheel zooms.',
                ],
            },
        ],
    },
];
