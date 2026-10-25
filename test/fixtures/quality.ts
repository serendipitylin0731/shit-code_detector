import { CodeFile } from '../../src/analysis';

const code = (path: string, language: string, content: string): CodeFile => ({ path, language, content });

export const qualityCases: { name: string; files: CodeFile[] }[] = [
  {
    name: 'good',
    files: [
      code('src/numbers.py', 'Python', [
        'def sum_even_numbers(numbers: list[int]) -> int:',
        '    """Return the sum of all even numbers in the input."""',
        '    return sum(number for number in numbers if number % 2 == 0)'
      ].join('\n')),
      code('tests/test_numbers.py', 'Python', [
        'from src.numbers import sum_even_numbers',
        '',
        'def test_sum_even_numbers():',
        '    assert sum_even_numbers([1, 2, 3, 4]) == 6',
        '    assert sum_even_numbers([]) == 0'
      ].join('\n'))
    ]
  },
  {
    name: 'medium',
    files: [
      code('src/calculate.py', 'Python', [
        'def calculate_total(prices):',
        '    temp = sum(prices)  ',
        '    return temp'
      ].join('\n')),
      code('src/labels.ts', 'TypeScript', [
        'export function makeLabel(value: string): string {',
        '  const temp = value;',
        '  return temp + " — this explanatory suffix is unnecessarily repeated across a single source line and makes the function harder to scan at a glance";',
        '}'
      ].join('\n'))
    ]
  },
  {
    name: 'bad',
    files: [
      code('src/main.py', 'Python', [
        'def process_everything():',
        ' \tfoo = 1  ',
        ...Array.from({ length: 425 }, () => '    temp = foo + 1  '),
        '    return temp'
      ].join('\n')),
      code('src/second.py', 'Python', [
        'def load():',
        '\tfoo = 1',
        '\tbar = 2',
        '\ttemp = foo + bar',
        '\treturn temp'
      ].join('\n')),
      code('src/third.py', 'Python', [
        'def save():',
        '    foo = 1',
        '    bar = 2',
        '    temp = foo + bar',
        '    return temp'
      ].join('\n')),
      code('src/unsafe.ts', 'TypeScript', [
        "import { helper } from './dependency';",
        'export function run(): number {',
        '  const first=helper();',
        '  const second=first+1;',
        '  try { return second; } catch (error) {}',
        '  return helper();',
        '}'
      ].join('\n')),
      code('src/dependency.ts', 'TypeScript', [
        "import { run } from './unsafe';",
        'export function helper(): number {',
        '  return run();',
        '}'
      ].join('\n'))
    ]
  }
];
