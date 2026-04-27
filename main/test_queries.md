# Test Queries for WIDO UI

Copy and paste these into the WIDO search bar to test different features.

## Variable Anchoring
- `($x r_isa animal)`
- `(chat r_isa $x)`

## Filtering & Patterns
- `($x r_isa animal) ET ($x = ba%)`
- `(($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x = ch%)`

## Advanced Logical Combinations
- `($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))`

## 2-Variable Joins (Experimental)
- `($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)`

## Error Cases
- `($x r_isa)` (Should show syntax error)
- `($x r_non_existent animal)` (Should show API error/warning)
