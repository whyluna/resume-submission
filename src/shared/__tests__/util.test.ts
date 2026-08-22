import { afterEach, describe, expect, it } from 'vitest'
import { cssPath } from '../util'

afterEach(() => { document.body.innerHTML = '' })

describe('stable CSS paths', () => {
  it('anchors directly at an ancestor id instead of claiming it is a body child', () => {
    document.body.innerHTML = '<main><section id="resume"><div><input id="target-child"></div></section></main>'
    const section = document.querySelector('#resume') as HTMLElement
    const nested = section.querySelector('div') as HTMLElement
    expect(cssPath(section)).toBe('#resume')
    expect(cssPath(nested)).toBe('#resume>div')
    expect(document.querySelector(cssPath(nested))).toBe(nested)
  })
})
