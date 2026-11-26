# Procedural deadline rules: draft for lawyer review

Status: **DRAFT, not verified, not approved, not used by the app.**

## Read this first
- This table was written by an AI assistant from general knowledge of the
  Romanian Civil Procedure Code (NCPC, Legea 134/2010, republished) and the
  Criminal Procedure Code (CPP, Legea 135/2010).
- The official consolidated texts on legislatie.just.ro
  ([NCPC](https://legislatie.just.ro/Public/DetaliiDocument/140271),
  [CPP](https://legislatie.just.ro/Public/DetaliiDocument/120611)) **could not be
  read automatically**: the site blocks automated access. **Article numbers,
  durations and starting points may be wrong or out of date.**
- Every row must be checked against the consolidated text **in force**, and
  against any special law, before it is approved.

## How DosarIA would use an approved table
- **Today:**
  - DosarIA calculates **nothing**.
  - After a ruling, the lawyer enters the communication date and the deadline
    date they determined themselves. The deadline then waits for the lawyer to
    confirm it (see `ARCHITECTURE.md` §7).
- **After approval:**
  - Once the reviewers sign the table (§4), DosarIA could **suggest** a date from
    it, but only when the lawyer has picked the rule and entered the start date.
  - The suggestion would still be "Proposed" and need the lawyer's
    confirmation.
  - Each rule would be versioned and linked to its article, and tested against a
    set of cases built by the lawyer (target: 100% correct).
- Switching this on requires written approval (see `docs/ROADMAP.md`, Phase D).

**Confidence column:**
- **H** = well known and stable.
- **M** = likely right, but check the details (starting point, exceptions).
- **L** = uncertain.

---

## 1. How deadlines are counted

| # | Rule | Basis (to verify) | Conf. | OK | Correction |
|---|---|---|---|---|---|
| 1.1 | **NCPC, deadlines in days:** the day the deadline starts and the day it ends are **not** counted (*zile libere*). | NCPC art. 181 alin. (1) pct. 2 | H | | |
| 1.2 | **NCPC, deadlines in weeks, months or years:** they end on the corresponding day of the last week, month or year. If that day does not exist in the month, they end on the last day of the month. | NCPC art. 181 alin. (1) pct. 3 | H | | |
| 1.3 | **NCPC:** if the last day is a **non-working day**, the deadline is extended to the end of the **next working day**. | NCPC art. 181 alin. (2) | H | | |
| 1.4 | **NCPC:** an act sent by post, courier, fax or e-mail before the end of the last day is in time. Documents filed at the court must be filed by the end of its working hours. | NCPC art. 182–183 | M | | |
| 1.5 | **CPP, deadlines in hours or days:** the starting hour or day is **not** counted, but the **last day is** counted. | CPP art. 269 alin. (2) | M | | |
| 1.6 | **CPP:** if the last day is a non-working day, the deadline ends at the end of the next working day. | CPP art. 269 alin. (4) | M | | |
| 1.7 | **CPP, deadlines for custodial and other preventive measures:** these are counted differently. Every hour and day is counted, and there is **no** extension to the next working day. *This is the weekend exception Delia mentioned.* | CPP art. 271 | M | | |
| 1.8 | **Non-working days:** Saturdays, Sundays and public holidays (Labour Code art. 139). DosarIA already has this calendar for scheduling, and it must be checked before it is used for deadlines. | Codul muncii art. 139; NCPC art. 181 | H | | |

## 2. Civil procedure (NCPC)

| # | Act / remedy | Time limit | Runs from | Basis (to verify) | Conf. | OK | Correction |
|---|---|---|---|---|---|---|---|
| 2.1 | Appeal (*apel*) | 30 days | Communication of the ruling, unless the law provides otherwise | art. 468 alin. (1) | H | | |
| 2.2 | Second appeal (*recurs*) | 30 days | Communication of the ruling, unless the law provides otherwise | art. 485 alin. (1) | H | | |
| 2.3 | Grounds of appeal / second appeal | Within the appeal / second-appeal period | Same as 2.1 / 2.2 | art. 470, art. 487 | M | | |
| 2.4 | Annulment challenge (*contestație în anulare*) | 15 days, and at most 1 year after the ruling became final | Communication of the ruling | art. 506 alin. (1) | M | | |
| 2.5 | Revision (*revizuire*) | 1 month | Depends on the ground (e.g. communication, discovery of the document, the final ruling in the related case) | art. 511 | M | | |
| 2.6 | Statement of defence (*întâmpinare*), first instance | 25 days | Communication of the statement of claim | art. 201 alin. (1) | H | | |
| 2.7 | Reply to the defence (*răspuns la întâmpinare*) | 10 days | Communication of the defence | art. 201 alin. (2) | H | | |
| 2.8 | Fixing deficiencies in the claim (*regularizare*) | 10 days | Communication of the court's request | art. 200 alin. (2) | H | | |
| 2.9 | Request for re-examination of the annulment of the claim | 15 days | Communication of the annulment order (*încheiere*) | art. 200 alin. (4) | M | | |
| 2.10 | Interim order (*ordonanță președințială*): appeal | 5 days | Pronouncement if the parties were summoned; communication if they were not | art. 1000 alin. (1) | M | | |
| 2.11 | Payment order (*ordonanță de plată*): application to annul it | 10 days | Service or communication of the order | art. 1023 alin. (1) | M | | |
| 2.12 | Small claim (*cerere de valoare redusă*): appeal | 30 days | Communication of the ruling | art. 1033 alin. (1) | M | | |
| 2.13 | Enforcement challenge (*contestație la executare*) | 15 days | The various moments in the article (e.g. when the challenger learned of the act being challenged) | art. 715 alin. (1) | M | | |
| 2.14 | Cross-appeal (*apel incident*) or third-party appeal (*apel provocat*) | Until the deadline for the defence in the appeal | — | art. 472 | L | | |

## 3. Criminal procedure (CPP)

| # | Act / remedy | Time limit | Runs from | Basis (to verify) | Conf. | OK | Correction |
|---|---|---|---|---|---|---|---|
| 3.1 | Appeal (*apel*) | 10 days | Communication of the copy of the operative part (*minuta*), for the prosecutor and all parties | art. 410 alin. (1) | M | | |
| 3.2 | Challenge (*contestație*), general rule | 3 days | Pronouncement or communication, unless the law provides otherwise | art. 425¹ | M | | |
| 3.3 | Challenge against preventive measures (e.g. pre-trial detention) | 48 hours | Pronouncement or communication; counted under 1.7 | art. 204 alin. (1); art. 206 | M | | |
| 3.4 | Appeal in cassation (*recurs în casație*) | 30 days | Communication of the appeal court's decision | art. 435 | M | | |
| 3.5 | Annulment challenge (*contestație în anulare*) | Depends on the ground: some within a fixed period, some at any time | Depends on the ground | art. 426–428 | L | | |
| 3.6 | Revision (*revizuire*) | Depends on the ground and on who requests it | Depends on the ground | art. 453–457 | L | | |

## 4. Other laws to consider later (not part of NCPC or CPP)

| # | Matter | Time limit | Runs from | Basis (to verify) | Conf. |
|---|---|---|---|---|---|
| 4.1 | Labour disputes: appeal | 10 days | Communication of the ruling | Legea 62/2011, art. 215 | M |
| 4.2 | Labour: challenge against a dismissal decision | 30 calendar days | Communication of the decision | Codul muncii art. 268 alin. (1) lit. a) | M |
| 4.3 | Administrative litigation: second appeal (*recurs*) | 15 days | Communication of the ruling | Legea 554/2004, art. 20 alin. (1) | M |
| 4.4 | Insolvency: appeal | 7 days | Communication of the ruling (check the article) | Legea 85/2014, art. 43 | L |

## 5. Questions for the reviewers

1. Which rows should the **first approved version** include? A short list covering the most common cases (2.1,
   2.2, 2.6, 2.7, 3.1) may be safer than everything at once.
2. When the communication date is unknown, should DosarIA keep asking for it, or propose anything? (Today it asks
   and proposes nothing.)
3. For criminal files, the appeal runs from the communication of the operative part (*minuta*): should the task say
   "copy of the operative part received" rather than "ruling communicated"?
4. Special laws (§4): include them in the first version or later?

## 6. Approval

| Reviewer | Role | Rows approved | Date | Signature |
|---|---|---|---|---|
| | Lawyer | | | |
| | Agora Origin (Delia) | | | |
