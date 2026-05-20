# Requêtes de test — WIDO

## Requêtes fondamentales

```
($x r_isa animal)
(chat r_isa $x)
(chat r_has_part $x)
```

## Filtres texte

```
($x r_isa animal) ET ($x = ch%)
($x r_isa animal) ET ($x = ba%)
($x r_isa artiste) ET ($x = ba%)
```

## Opérateurs OU

```
($x r_isa mammifere) OU ($x r_isa oiseau)
(($x r_isa mammifere) OU ($x r_isa oiseau)) ET ($x = ch%)
($x r_isa artiste) ET (($x = ba%) OU ($x = Ba%))
($x r_isa animal) ET (($x r_has_part aile) OU ($x r_has_part queue))
```

## Jointures ET (2 variables)

```
($x r_isa animal) ET ($x r_has_part queue)
($x r_isa animal) ET ($x r_has_color blanc)
($x r_isa animal) ET ($x r_carac domestique)
```

## Requêtes officielles du sujet TER

```
($x r_isa animal) ET ($y r_isa animal) ET ($x r_can_eat $y)
(lion r_can_eat $y) ET ($y r_isa animal)
(chat r_can_eat $y) ET ($y r_isa animal)
```

## Chaînes de 3 variables

```
(chat r_has_part $y) ET ($y r_isa $z)
($x r_isa animal) ET ($x r_has_part $y) ET ($y = pa%)
($x r_isa animal) ET ($x r_has_part $y) ET ($y r_isa $z)
```

## Cas d'erreurs (à montrer en démo)

```
($x r_isa)
($x relation_inconnue animal)
```
