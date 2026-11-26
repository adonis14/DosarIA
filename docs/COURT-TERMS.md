# Court terms: English glosses for lawyer review

Status: **draft, not yet reviewed by a lawyer.** Source of the glosses: `src/i18n/court-terms.ts`.

## How the app uses these
- The interface is Romanian by default. In Romanian, court text is always shown exactly as the court published it.
- In English, the interface shows the gloss **next to** the Romanian original, for example
  "Appeal for annulment (Recurs în anulare)". A lawyer can always match it to the court record.
- Unknown wording is shown unchanged and is never guessed.
- Glosses are reading aids, not legal translations. The Romanian text is the authoritative one.

## What we ask the reviewer
For each row:
- tick **OK** if the English is acceptable, or
- write a better wording under **Correction**.

Please also add any **common terms that are missing**, for example hearing outcomes you see often.

## 1. Procedural stages (`stadiuProcesual`): all 19 official values

These come from the portal's service definition (WSDL, type `StadiuProcesual`). The portal sends either the code
(no spaces or diacritics) or a display name. The Romanian wording in the second column is reconstructed from the
code, because the official display names were not available to us.

| # | Code | Romanian (reconstructed) | English gloss | OK | Correction |
|---|---|---|---|---|---|
| 1 | `Fond` | Fond | First instance | | |
| 2 | `Apel` | Apel | Appeal | | |
| 3 | `Recurs` | Recurs | Second appeal (on points of law) | | |
| 4 | `Recursinanulare` | Recurs în anulare | Appeal for annulment | | |
| 5 | `Recursininteresullegii` | Recurs în interesul legii | Appeal in the interest of the law | | |
| 6 | `Contestatie` | Contestație | Challenge | | |
| 7 | `Revizuire` | Revizuire | Revision | | |
| 8 | `Contestatieinanulare` | Contestație în anulare | Annulment challenge | | |
| 9 | `Stabilireacompetentei` | Stabilirea competenței | Determination of jurisdiction | | |
| 10 | `Recursimpotrivaincheierii` | Recurs împotriva încheierii | Appeal against an interim ruling (încheiere) | | |
| 11 | `Recuzare` | Recuzare | Recusal of a judge | | |
| 12 | `Stramutare` | Strămutare | Transfer of venue | | |
| 13 | `Indreptareeroaremateriala` | Îndreptare eroare materială | Correction of a clerical error | | |
| 14 | `ContestatieinanulareFond` | Contestație în anulare / Fond | Annulment challenge — first instance | | |
| 15 | `ContestatieinanulareApel` | Contestație în anulare / Apel | Annulment challenge — appeal | | |
| 16 | `ContestatieinanulareRecurs` | Contestație în anulare / Recurs | Annulment challenge — second appeal | | |
| 17 | `RevizuireFond` | Revizuire / Fond | Revision — first instance | | |
| 18 | `RevizuireApel` | Revizuire / Apel | Revision — appeal | | |
| 19 | `RevizuireRecurs` | Revizuire / Recurs | Revision — second appeal | | |

Other stage wording the app also recognises: Recurs în casație (Appeal in cassation), Fond după casare cu
trimitere (Retrial after cassation), Apel după casare cu trimitere (Appeal after cassation), Cameră preliminară
(Preliminary chamber), Cameră de consiliu (Council chamber), Contestație (NCPP) (Challenge (Criminal Procedure Code)),
Executare (Enforcement), Contestație la executare (Enforcement challenge), Sesizare (Referral).

## 2. Case categories (`categorieCaz`): all 11 official values

| # | Code | Romanian (reconstructed) | English gloss | OK | Correction |
|---|---|---|---|---|---|
| 1 | `Penal` | Penal | Criminal | | |
| 2 | `Civil` | Civil | Civil | | |
| 3 | `Comercial` | Comercial | Commercial | | |
| 4 | `Contenciosadministrativsifiscal` | Contencios administrativ și fiscal | Administrative and tax litigation | | |
| 5 | `Minorisifamilie` | Minori și familie | Minors and family | | |
| 6 | `Litigiidemunca` | Litigii de muncă | Labour disputes | | |
| 7 | `Altematerii` | Alte materii | Other matters | | |
| 8 | `Asigurarisociale` | Asigurări sociale | Social insurance | | |
| 9 | `Faliment` | Faliment | Bankruptcy | | |
| 10 | `ProprietateIntelectuala` | Proprietate intelectuală | Intellectual property | | |
| 11 | `Dreptmaritimsifluvial` | Drept maritim și fluvial | Maritime and river law | | |

## 3. Hearing outcomes (`solutie`) the app recognises

Values marked * were seen on the live portal on 2026-11-23. The others are common wording.

| Romanian | English gloss | OK | Correction |
|---|---|---|---|
| Amână cauza * | Case adjourned | | |
| Amână pronunțarea * | Ruling postponed | | |
| Admite cererea * | Claim granted | | |
| Admite în parte cererea | Claim partially granted | | |
| Respinge cererea | Claim dismissed | | |
| Respinge acțiunea | Action dismissed | | |
| Anulează | Annulled | | |
| Suspendă judecata | Proceedings suspended | | |
| Termen preschimbat * | Hearing date changed | | |
| Alte soluții * | Other outcome | | |
| Declină competența | Jurisdiction declined | | |
| Constată perimarea | Proceedings lapsed (perimare) | | |
| Renunțare la judecată | Claim withdrawn | | |
| Închide dosarul | Case closed | | |
| Încetare | Proceedings discontinued | | |
| Repunere pe rol | Case reinstated | | |
| Conexare | Cases joined | | |
| Disjunge | Cases severed | | |

**How DosarIA classifies an outcome today** (`classifySolution` in `src/server/monitoring/normalize.ts`):
- Wording starting with "Amână" → postponement.
- Wording containing admite, respinge, anulează, constată, hotărăște, soluționat, închide, încuviințează, dispune or obligă → ruling.
- **Anything else → unclassified.** It is recorded as a ruling marked "Needs human review", and it opens a
  "communication date needed" task. This deliberately errs on the side of asking.

**Questions for the reviewer:**
1. **"Termen preschimbat"** is a change of hearing date, not a ruling, yet today it falls under "unclassified".
   Should it be treated like a postponement (no ruling task)?
2. **"Alte soluții"**: is "needs human review + ruling task" the right default?
3. Are there outcomes that start no appeal deadline and should never open a ruling task?

## 4. Case statuses

| Romanian | English gloss | OK | Correction |
|---|---|---|---|
| În curs de judecată | Pending trial | | |
| Soluționat | Decided | | |
| Suspendat | Suspended | | |
| În curs (dedus din ședințe) | Pending (derived from hearings) | | |
| Soluționat (dedus din ședințe) | Decided (derived from hearings) | | |

"(dedus din ședințe)" means DosarIA derived the status from the hearing list, because the portal does not publish a
status field.
