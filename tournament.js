(function () {
    'use strict';

    const tournament = JSON.parse(localStorage.getItem('currentTournament') || 'null');
    const page = document.body.dataset.page || '';
    const teamMode = tournament?.category === 'team';
    const tournamentType = tournament?.type;
    const storageKey = tournament
        ? `tournamentState:${encodeURIComponent(tournament.name)}:${tournament.category}:${tournament.type}`
        : '';
    const competitorKey = teamMode ? 'teamLeaderboard' : 'leaderboard';

    function competitors() {
        const values = JSON.parse(localStorage.getItem(competitorKey) || '[]');
        if (!teamMode) return values.filter(player => player.name);
        return values.filter(team => team.name).map(team => ({
            ...team,
            members: (team.members || []).map(member => typeof member === 'string'
                ? { name: member, score: 0 }
                : member)
        }));
    }

    function names() {
        return competitors().map(player => player.name);
    }

    function createState() {
        const baseline = {};
        competitors().forEach(competitor => {
            if (teamMode) {
                competitor.members.forEach((member, index) => {
                    baseline[`${competitor.name}|${index}`] = Number(member.score) || 0;
                });
            } else {
                baseline[competitor.name] = Number(competitor.score) || 0;
            }
        });
        return {
            rounds: [],
            results: {},
            baseline,
            swissRounds: Number(tournament.swissRounds) || null
        };
    }

    function getState() {
        let state = JSON.parse(localStorage.getItem(storageKey) || 'null');
        if (!state) {
            state = createState();
            saveState(state);
        }
        if (!state.results) state.results = {};
        if (!state.baseline) state.baseline = createState().baseline;
        if (!Array.isArray(state.rounds)) state.rounds = [];
        return state;
    }

    function saveState(state) {
        localStorage.setItem(storageKey, JSON.stringify(state));
    }

    function resultKey(roundIndex, matchIndex, boardIndex) {
        return `${roundIndex}:${matchIndex}:${boardIndex}`;
    }

    function points(result) {
        return result === 'win' ? 1 : result === 'draw' ? 0.5 : 0;
    }

    function opposingResult(result) {
        return result === 'win' ? 'loss' : result === 'loss' ? 'win' : result;
    }

    function boardCount(match) {
        if (!teamMode) return 1;
        const teams = competitors();
        const first = teams.find(team => team.name === match.a);
        const second = teams.find(team => team.name === match.b);
        return Math.min(first?.members.length || 0, second?.members.length || 0);
    }

    function getResult(state, roundIndex, matchIndex, boardIndex) {
        return state.results[resultKey(roundIndex, matchIndex, boardIndex)] || '';
    }

    function hasUnrecordedScores(state) {
        return state.rounds.some((round, roundIndex) =>
            round.matches.some((match, matchIndex) => {
                if (!match.a || !match.b) return false;
                for (let board = 0; board < boardCount(match); board++) {
                    if (!getResult(state, roundIndex, matchIndex, board)) return true;
                }
                return false;
            }));
    }

    function participantPoints(state, name) {
        let total = 0;
        state.rounds.forEach((round, roundIndex) => {
            if (round.bye === name) total += 1;
            round.matches.forEach((match, matchIndex) => {
                if (teamMode) {
                    for (let board = 0; board < boardCount(match); board++) {
                        const result = getResult(state, roundIndex, matchIndex, board);
                        if (!result) continue;
                        if (match.a === name) total += points(result);
                        if (match.b === name) total += points(opposingResult(result));
                    }
                } else {
                    const result = getResult(state, roundIndex, matchIndex, 0);
                    if (!result) return;
                    if (match.a === name) total += points(result);
                    if (match.b === name) total += points(opposingResult(result));
                }
            });
        });
        return total;
    }

    function matchResultFor(state, roundIndex, matchIndex, boardIndex, name, match) {
        const result = getResult(state, roundIndex, matchIndex, boardIndex);
        if (!result) return '';
        return teamMode
            ? match.a === name ? result : match.b === name ? opposingResult(result) : ''
            : match.a === name ? result : match.b === name ? opposingResult(result) : '';
    }

    function baselinePoints(name) {
        const baseline = stateBaseline();
        if (!teamMode) return Number(baseline[name]) || 0;
        const team = competitors().find(candidate => candidate.name === name);
        return team?.members?.reduce((total, member, index) => {
            const key = `${name}|${index}`;
            const value = Object.prototype.hasOwnProperty.call(baseline, key)
                ? baseline[key]
                : member.score;
            return total + (Number(value) || 0);
        }, 0) || 0;
    }

    let activeState = null;

    function stateBaseline() {
        return activeState?.baseline || createState().baseline;
    }

    function finalPoints(state, name) {
        activeState = state;
        return baselinePoints(name) + participantPoints(state, name);
    }

    function opponents(state, name) {
        const found = [];
        state.rounds.forEach(round => {
            if (round.bye === name) return;
            round.matches.forEach(match => {
                if (match.a === name && match.b) found.push(match.b);
                if (match.b === name && match.a) found.push(match.a);
            });
        });
        return found;
    }

    function buchholz(state, name) {
        return opponents(state, name).reduce((total, opponent) => total + finalPoints(state, opponent), 0);
    }

    function median(state, name) {
        const scores = opponents(state, name).map(opponent => finalPoints(state, opponent)).sort((a, b) => b - a);
        if (scores.length < 2) return scores.reduce((total, score) => total + score, 0);
        scores.shift();
        scores.pop();
        return scores.reduce((total, score) => total + score, 0);
    }

    function sonnebornBerger(state, name) {
        let total = 0;
        state.rounds.forEach((round, roundIndex) => {
            round.matches.forEach((match, matchIndex) => {
                if (match.a !== name && match.b !== name) return;
                const opponent = match.a === name ? match.b : match.a;
                if (!opponent) return;
                for (let board = 0; board < boardCount(match); board++) {
                    const result = matchResultFor(state, roundIndex, matchIndex, board, name, match);
                    if (result === 'win') total += finalPoints(state, opponent);
                    if (result === 'draw') total += finalPoints(state, opponent) / 2;
                }
            });
        });
        return total;
    }

    function directEncounter(state, name, opponent) {
        let total = 0;
        state.rounds.forEach((round, roundIndex) => {
            round.matches.forEach((match, matchIndex) => {
                if (!((match.a === name && match.b === opponent) || (match.a === opponent && match.b === name))) return;
                for (let board = 0; board < boardCount(match); board++) {
                    const result = matchResultFor(state, roundIndex, matchIndex, board, name, match);
                    total += points(result);
                }
            });
        });
        return total;
    }

    function blackWins(state, name) {
        if (teamMode) return 0;
        let total = 0;
        state.rounds.forEach((round, roundIndex) => {
            round.matches.forEach((match, matchIndex) => {
                if (match.black !== name) return;
                const result = getResult(state, roundIndex, matchIndex, 0);
                if (match.a === name && result === 'win') total++;
                if (match.b === name && result === 'loss') total++;
            });
        });
        return total;
    }

    function tiebreakValue(state, name, opponent, id) {
        if (id === 'buchholz') return buchholz(state, name);
        if (id === 'median') return median(state, name);
        if (id === 'sonnebornBerger') return sonnebornBerger(state, name);
        if (id === 'directEncounter') return directEncounter(state, name, opponent);
        if (id === 'blackPieces') return blackWins(state, name);
        return 0;
    }

    function standings(state) {
        const entries = names().map(name => ({
            name,
            points: finalPoints(state, name)
        }));
        const selectedIds = Array.isArray(tournament?.tiebreaks) ? tournament.tiebreaks : [];
        return entries.sort((a, b) => {
            if (b.points !== a.points) return b.points - a.points;
            for (const id of selectedIds) {
                const difference = tiebreakValue(state, b.name, a.name, id) - tiebreakValue(state, a.name, b.name, id);
                if (difference !== 0) return difference;
            }
            return a.name.localeCompare(b.name);
        });
    }

    function findSwissBye(state, orderedNames) {
        for (let index = orderedNames.length - 1; index >= 0; index--) {
            const name = orderedNames[index];
            if (!state.rounds.some(round => round.bye === name)) return name;
        }
        return orderedNames[orderedNames.length - 1];
    }

    function assignSwissColors(match, colorCounts, roundIndex, matchIndex) {
        const first = colorCounts.get(match.a);
        const second = colorCounts.get(match.b);
        const firstBalance = first.white - first.black;
        const secondBalance = second.white - second.black;
        const firstWhiteCost = (firstBalance + 1) ** 2 + (secondBalance - 1) ** 2;
        const secondWhiteCost = (firstBalance - 1) ** 2 + (secondBalance + 1) ** 2;
        let firstIsWhite = firstWhiteCost < secondWhiteCost;

        if (firstWhiteCost === secondWhiteCost) {
            const firstWhiteRepeats = Number(first.lastColor === 'white') + Number(second.lastColor === 'black');
            const secondWhiteRepeats = Number(first.lastColor === 'black') + Number(second.lastColor === 'white');
            firstIsWhite = firstWhiteRepeats === secondWhiteRepeats
                ? (roundIndex + matchIndex) % 2 === 0
                : firstWhiteRepeats < secondWhiteRepeats;
        }

        match.white = firstIsWhite ? match.a : match.b;
        match.black = firstIsWhite ? match.b : match.a;
        const white = colorCounts.get(match.white);
        const black = colorCounts.get(match.black);
        white.white++;
        white.lastColor = 'white';
        black.black++;
        black.lastColor = 'black';
    }

    function createSwissRound(state) {
        const ranked = standings(state).map(player => player.name);
        let bye = null;
        if (ranked.length % 2) bye = findSwissBye(state, ranked);
        const available = ranked.filter(name => name !== bye);
        const matches = [];
        const colorCounts = new Map(names().map(name => [name, { white: 0, black: 0, lastColor: null }]));
        state.rounds.forEach(round => {
            round.matches.forEach(match => {
                if (!match.white || !match.black) return;
                const white = colorCounts.get(match.white);
                const black = colorCounts.get(match.black);
                if (white) {
                    white.white++;
                    white.lastColor = 'white';
                }
                if (black) {
                    black.black++;
                    black.lastColor = 'black';
                }
            });
        });
        while (available.length) {
            const first = available.shift();
            let opponentIndex = available.findIndex(candidate =>
                !state.rounds.some(round => round.matches.some(match =>
                    (match.a === first && match.b === candidate) ||
                    (match.a === candidate && match.b === first))));
            if (opponentIndex === -1) opponentIndex = 0;
            const match = { a: first, b: available.splice(opponentIndex, 1)[0] };
            assignSwissColors(match, colorCounts, state.rounds.length, matches.length);
            matches.push(match);
        }
        state.rounds.push({ matches, bye });
    }

    function createRoundRobin() {
        const entrants = names();
        const slots = entrants.slice();
        if (slots.length % 2) slots.push(null);
        const rounds = [];
        for (let roundIndex = 0; roundIndex < slots.length - 1; roundIndex++) {
            const matches = [];
            let bye = null;
            for (let index = 0; index < slots.length / 2; index++) {
                const first = slots[index];
                const second = slots[slots.length - 1 - index];
                if (!first || !second) {
                    bye = first || second;
                } else {
                    const firstIsWhite = (roundIndex + index) % 2 === 0;
                    matches.push({
                        a: first,
                        b: second,
                        white: firstIsWhite ? first : second,
                        black: firstIsWhite ? second : first
                    });
                }
            }
            rounds.push({ matches, bye });
            slots.splice(1, 0, slots.pop());
        }
        return rounds;
    }

    function knockoutWinner(state, roundIndex, matchIndex, match) {
        if (!match.a) return match.b;
        if (!match.b) return match.a;
        if (teamMode) {
            let firstPoints = 0;
            let secondPoints = 0;
            for (let board = 0; board < boardCount(match); board++) {
                const result = getResult(state, roundIndex, matchIndex, board);
                if (result === 'win') firstPoints++;
                if (result === 'loss') secondPoints++;
            }
            if (firstPoints > secondPoints) return match.a;
            if (secondPoints > firstPoints) return match.b;
            return null;
        }
        const result = getResult(state, roundIndex, matchIndex, 0);
        return result === 'win' ? match.a : result === 'loss' ? match.b : null;
    }

    function advanceKnockout(state) {
        state.rounds.slice(1).forEach(round => {
            round.matches.forEach(match => {
                match.a = null;
                match.b = null;
            });
        });
        for (let roundIndex = 0; roundIndex < state.rounds.length - 1; roundIndex++) {
            state.rounds[roundIndex].matches.forEach((match, matchIndex) => {
                const winner = knockoutWinner(state, roundIndex, matchIndex, match);
                if (winner) {
                    const nextMatch = state.rounds[roundIndex + 1].matches[Math.floor(matchIndex / 2)];
                    nextMatch[matchIndex % 2 === 0 ? 'a' : 'b'] = winner;
                }
            });
        }
    }

    function createKnockout() {
        const entrants = names();
        const size = Math.max(2, 2 ** Math.ceil(Math.log2(entrants.length)));
        const rounds = [];
        for (let count = size; count > 1; count /= 2) {
            rounds.push({
                matches: Array.from({ length: count / 2 }, () => ({ a: null, b: null }))
            });
        }
        entrants.forEach((name, index) => {
            const match = rounds[0].matches[Math.floor(index / 2)];
            match[index % 2 === 0 ? 'a' : 'b'] = name;
        });
        const state = { rounds, results: {}, baseline: createState().baseline, swissRounds: null };
        advanceKnockout(state);
        return state;
    }

    function renderLeaderboardActions() {
        const actions = document.getElementById('tournamentActions');
        if (actions) {
            actions.hidden = !tournament || !['RoundRobin', 'SwissSystem', 'Knockout'].includes(tournamentType);
        }
    }

    function setMessage(text) {
        const message = document.getElementById('message');
        if (message) message.textContent = text;
    }

    function renderRoundList(state) {
        const container = document.getElementById('rounds');
        container.replaceChildren();
        state.rounds.forEach((round, roundIndex) => {
            const section = document.createElement('section');
            section.className = 'round';
            const heading = document.createElement('h2');
            heading.textContent = `Round ${roundIndex + 1}`;
            section.appendChild(heading);
            round.matches.forEach(match => {
                const item = document.createElement('p');
                item.className = 'match';
                item.textContent = match.white && match.black
                    ? `${match.white} (White) vs ${match.black} (Black)`
                    : `${match.a} vs ${match.b}`;
                section.appendChild(item);
            });
            if (round.bye) {
                const bye = document.createElement('p');
                bye.className = 'match';
                bye.textContent = `${round.bye} has a bye`;
                section.appendChild(bye);
            }
            container.appendChild(section);
        });
    }

    function renderBracket(state) {
        const container = document.getElementById('bracket');
        container.replaceChildren();
        state.rounds.forEach((round, roundIndex) => {
            const visibleMatches = round.matches.filter(match => match.a || match.b);
            if (!visibleMatches.length) return;
            const column = document.createElement('section');
            column.className = 'bracket-round';
            const heading = document.createElement('h2');
            heading.textContent = roundIndex === state.rounds.length - 1
                ? 'Final'
                : `Round ${roundIndex + 1}`;
            column.appendChild(heading);
            visibleMatches.forEach(match => {
                const card = document.createElement('div');
                card.className = 'bracket-match';
                card.textContent = `${match.a || '—'}\nvs\n${match.b || '—'}`;
                column.appendChild(card);
            });
            container.appendChild(column);
        });
    }

    function renderPairingPage() {
        const controls = document.getElementById('controls');
        controls.replaceChildren();
        if (!tournament || !['RoundRobin', 'SwissSystem', 'Knockout'].includes(tournamentType)) {
            setMessage('Open pairings from a round-robin, Swiss, or knockout tournament leaderboard.');
            return;
        }
        const leaderboardLink = document.querySelector('a[href="leaderboard.html"]');
        if (leaderboardLink && teamMode) leaderboardLink.href = 'leaderboard.html?mode=team';
        document.getElementById('pageTitle').textContent = `${tournament.name} Pairings`;
        document.getElementById('tournamentInfo').textContent =
            `${teamMode ? 'Team' : 'Individual'} ${tournamentType} tournament`;
        if (!names().length) {
            setMessage('Add players or teams on the leaderboard before generating pairings.');
            return;
        }

        const state = getState();
        if (tournamentType === 'RoundRobin' && state.rounds.length === 0) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Generate Pairings';
            button.addEventListener('click', () => {
                state.rounds = createRoundRobin();
                saveState(state);
                renderPairingPage();
            });
            controls.appendChild(button);
        } else if (tournamentType === 'SwissSystem') {
            if (!state.swissRounds) {
                const label = document.createElement('label');
                label.htmlFor = 'swissRoundCount';
                label.textContent = 'Initial number of rounds: ';
                const input = document.createElement('input');
                input.id = 'swissRoundCount';
                input.type = 'number';
                input.min = '1';
                input.step = '1';
                input.value = '5';
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = 'Save and generate first round';
                button.addEventListener('click', () => {
                    const count = Number(input.value);
                    if (!Number.isInteger(count) || count < 1) {
                        setMessage('Enter a whole number of rounds greater than zero.');
                        return;
                    }
                    state.swissRounds = count;
                    tournament.swissRounds = count;
                    localStorage.setItem('currentTournament', JSON.stringify(tournament));
                    createSwissRound(state);
                    saveState(state);
                    renderPairingPage();
                });
                controls.append(label, input, button);
            } else if (state.rounds.length < state.swissRounds) {
                const button = document.createElement('button');
                button.type = 'button';
                button.textContent = state.rounds.length ? 'Generate Next Round' : 'Generate First Round';
                button.addEventListener('click', () => {
                    if (state.rounds.length && hasUnrecordedScores(state) &&
                        !window.confirm('Some scores have not been recorded. Generate the next round anyway?')) {
                        return;
                    }
                    createSwissRound(state);
                    saveState(state);
                    renderPairingPage();
                });
                controls.appendChild(button);
            }
        } else if (tournamentType === 'Knockout' && state.rounds.length === 0) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Generate Bracket';
            button.addEventListener('click', () => {
                localStorage.setItem(storageKey, JSON.stringify(createKnockout()));
                renderPairingPage();
            });
            controls.appendChild(button);
        }

        if (state.rounds.length) {
            if (tournamentType === 'Knockout') renderBracket(state);
            else renderRoundList(state);

            const exportButton = document.createElement('button');
            exportButton.type = 'button';
            exportButton.textContent = 'Export Pairings as PDF';
            exportButton.addEventListener('click', () => exportPairingsPdf(state));
            controls.appendChild(exportButton);
        }
    }

    function pdfSafeText(text) {
        return String(text)
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\x20-\x7E]/g, '?')
            .replace(/\\/g, '\\\\')
            .replace(/\(/g, '\\(')
            .replace(/\)/g, '\\)');
    }

    function wrapPdfLine(text, width = 88) {
        const words = String(text).split(/\s+/);
        const lines = [];
        let line = '';
        words.forEach(word => {
            if ((line + (line ? ' ' : '') + word).length <= width) {
                line += (line ? ' ' : '') + word;
            } else {
                if (line) lines.push(line);
                line = word;
            }
        });
        if (line) lines.push(line);
        return lines;
    }

    function exportPairingsPdf(state) {
        const lines = [
            `${tournament.name} Pairings`,
            `${teamMode ? 'Team' : 'Individual'} ${tournamentType} tournament`,
            ''
        ];

        state.rounds.forEach((round, roundIndex) => {
            const roundTitle = tournamentType === 'Knockout' && roundIndex === state.rounds.length - 1
                ? 'Final'
                : `Round ${roundIndex + 1}`;
            lines.push(roundTitle);

            round.matches.forEach((match, matchIndex) => {
                if (!match.a && !match.b) return;
                const pairing = match.white && match.black
                    ? `${match.white} (White) vs ${match.black} (Black)`
                    : `${match.a || '—'} vs ${match.b || '—'}`;
                lines.push(`${matchIndex + 1}. ${pairing}`);
            });

            if (round.bye) lines.push(`Bye: ${round.bye}`);
            lines.push('');
        });

        const wrappedLines = [];
        lines.forEach(line => {
            const parts = wrapPdfLine(line);
            wrappedLines.push(...(parts.length ? parts : ['']));
        });

        const pageLines = [];
        for (let index = 0; index < wrappedLines.length; index += 48) {
            pageLines.push(wrappedLines.slice(index, index + 48));
        }
        if (!pageLines.length) pageLines.push(['No pairings']);

        let pdf = '%PDF-1.4\n';
        const objects = [];
        objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';

        const pageRefs = pageLines.map((_, index) => `${4 + index * 2} 0 R`);
        objects[2] = `<< /Type /Pages /Kids [${pageRefs.join(' ')}] /Count ${pageLines.length} >>`;
        objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';

        pageLines.forEach((pageContent, pageIndex) => {
            const pageObjectId = 4 + pageIndex * 2;
            const contentObjectId = pageObjectId + 1;
            const textCommands = pageContent.map((line, lineIndex) => {
                const y = 790 - lineIndex * 15;
                const prefix = lineIndex === 0 ? 'BT' : '';
                return `${prefix}${prefix ? ' ' : ''}/F1 11 Tf 50 ${y} Td (${pdfSafeText(line)}) Tj`;
            }).join('\n');
            const stream = `BT\n/F1 11 Tf\n50 790 Td\n14 TL\n` +
                pageContent.map((line, lineIndex) =>
                    `${lineIndex === 0 ? '' : 'T* '}(${pdfSafeText(line)}) Tj`
                ).join('\n') + '\nET';

            objects[pageObjectId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectId} 0 R >>`;
            objects[contentObjectId] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
        });

        const offsets = [0];
        for (let objectId = 1; objectId < objects.length; objectId++) {
            if (!objects[objectId]) continue;
            offsets[objectId] = pdf.length;
            pdf += `${objectId} 0 obj\n${objects[objectId]}\nendobj\n`;
        }

        const xrefOffset = pdf.length;
        const maxObjectId = objects.length - 1;
        pdf += `xref\n0 ${maxObjectId + 1}\n`;
        pdf += '0000000000 65535 f \n';
        for (let objectId = 1; objectId <= maxObjectId; objectId++) {
            pdf += `${objects[objectId] ? String(offsets[objectId]).padStart(10, '0') : '0000000000'} 00000 n \n`;
        }
        pdf += `trailer\n<< /Size ${maxObjectId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

        const blob = new Blob([pdf], { type: 'application/pdf' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const safeName = tournament.name.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'tournament';
        link.href = url;
        link.download = `${safeName}-pairings.pdf`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    }

    function findMatch(round, name) {
        return round.matches.findIndex(match => match.a === name || match.b === name);
    }

    function createOutcomeCell(state, roundIndex, matchIndex, boardIndex, viewedName, match, opponent) {
        const cell = document.createElement('td');
        const opponentLabel = document.createElement('div');
        opponentLabel.className = 'opponent';
        const color = match.white && match.black
            ? match.white === viewedName ? 'White' : 'Black'
            : '';
        opponentLabel.textContent = opponent ? `vs ${opponent}${color ? ` (${color})` : ''}` : 'No opponent';
        cell.appendChild(opponentLabel);
        if (!opponent) return cell;

        const select = document.createElement('select');
        select.setAttribute('aria-label', `${viewedName}, round ${roundIndex + 1} result`);
        const options = [['', 'Not recorded'], ['win', 'Win'], ['draw', 'Draw'], ['loss', 'Loss']];
        options.forEach(([value, label]) => {
            const option = document.createElement('option');
            option.value = value;
            option.textContent = label;
            select.appendChild(option);
        });
        const viewedIsA = teamMode
            ? match.a === document.getElementById('teamSelector').value
            : match.a === viewedName;
        const storedResult = getResult(state, roundIndex, matchIndex, boardIndex);
        select.value = viewedIsA ? storedResult : opposingResult(storedResult);
        if (!storedResult) select.value = '';
        select.addEventListener('change', () => {
            const result = viewedIsA ? select.value : opposingResult(select.value);
            const key = resultKey(roundIndex, matchIndex, boardIndex);
            if (result) state.results[key] = result;
            else delete state.results[key];
            if (tournamentType === 'Knockout') {
                Object.keys(state.results).forEach(resultId => {
                    if (Number(resultId.split(':')[0]) > roundIndex) delete state.results[resultId];
                });
                advanceKnockout(state);
            }
            saveState(state);
            recalculateScores(state);
            renderScorePage();
        });
        cell.appendChild(select);
        return cell;
    }

    function recalculateScores(state) {
        const stored = competitors();
        if (teamMode) {
            stored.forEach(team => {
                team.members = (team.members || []).map((member, memberIndex) => {
                    const normalized = typeof member === 'string' ? { name: member, score: 0 } : member;
                    let score = Number(state.baseline[`${team.name}|${memberIndex}`]) || 0;
                    state.rounds.forEach((round, roundIndex) => {
                        round.matches.forEach((match, matchIndex) => {
                            if (match.a !== team.name && match.b !== team.name) return;
                            const board = getResult(state, roundIndex, matchIndex, memberIndex);
                            const value = match.a === team.name ? board : opposingResult(board);
                            score += points(value);
                        });
                    });
                    return { ...normalized, score };
                });
                team.score = team.members.reduce((total, member) => total + (Number(member.score) || 0), 0);
            });
        } else {
            stored.forEach(player => {
                let score = Number(state.baseline[player.name]) || 0;
                state.rounds.forEach((round, roundIndex) => {
                    if (round.bye === player.name) score += 1;
                    round.matches.forEach((match, matchIndex) => {
                        const result = getResult(state, roundIndex, matchIndex, 0);
                        score += match.a === player.name ? points(result)
                            : match.b === player.name ? points(opposingResult(result)) : 0;
                    });
                });
                player.score = score;
            });
        }
        localStorage.setItem(competitorKey, JSON.stringify(stored));
        saveState(state);
    }

    function renderScorePage() {
        if (!tournament || !['RoundRobin', 'SwissSystem', 'Knockout'].includes(tournamentType)) {
            setMessage('Open score recording from a round-robin, Swiss, or knockout tournament leaderboard.');
            return;
        }
        const leaderboardLink = document.querySelector('a[href="leaderboard.html"]');
        if (leaderboardLink && teamMode) leaderboardLink.href = 'leaderboard.html?mode=team';
        const state = getState();
        document.getElementById('pageTitle').textContent = `${tournament.name} Score Round`;
        if (!state.rounds.length) {
            setMessage('Generate pairings before recording scores.');
            return;
        }
        const selector = document.getElementById('teamSelector');
        const selectorLabel = document.getElementById('teamSelectorLabel');
        const individualSelector = document.getElementById('individualSelector');
        const playerSearch = document.getElementById('playerSearch');
        const playerSelector = document.getElementById('playerSelector');
        if (teamMode) {
            individualSelector.hidden = true;
            selector.hidden = false;
            selectorLabel.hidden = false;
            const allTeams = competitors();
            const previousSelection = selector.value;
            selector.replaceChildren();
            allTeams.forEach(team => {
                const option = document.createElement('option');
                option.value = team.name;
                option.textContent = team.name;
                selector.appendChild(option);
            });
            if (allTeams.some(team => team.name === previousSelection)) selector.value = previousSelection;
            selector.onchange = renderScorePage;
        } else {
            selector.hidden = true;
            selectorLabel.hidden = true;
            individualSelector.hidden = false;
            const query = playerSearch.value.trim().toLocaleLowerCase();
            const matchingPlayers = names().filter(name => name.toLocaleLowerCase().includes(query));
            const previousSelection = playerSelector.value;
            playerSelector.replaceChildren();
            matchingPlayers.forEach(name => {
                const option = document.createElement('option');
                option.value = name;
                option.textContent = name;
                playerSelector.appendChild(option);
            });
            playerSelector.value = matchingPlayers.includes(previousSelection)
                ? previousSelection
                : matchingPlayers[0] || '';
            playerSearch.oninput = renderScorePage;
            playerSelector.onchange = renderScorePage;
        }

        const columns = teamMode
            ? (competitors().find(team => team.name === selector.value)?.members || [])
                .map(member => typeof member === 'string' ? member : member.name)
            : names();
        const header = document.getElementById('scoreHead');
        const body = document.getElementById('scoreBody');
        header.replaceChildren();
        body.replaceChildren();
        const headerRow = document.createElement('tr');
        const visibleColumns = teamMode ? columns : [playerSelector.value].filter(Boolean);
        ['Round', ...visibleColumns].forEach(title => {
            const th = document.createElement('th');
            th.textContent = title;
            headerRow.appendChild(th);
        });
        header.appendChild(headerRow);
        if (!teamMode && !playerSelector.value) {
            setMessage('No players match your search.');
            return;
        }

        state.rounds.forEach((round, roundIndex) => {
            const row = document.createElement('tr');
            const roundCell = document.createElement('th');
            roundCell.scope = 'row';
            roundCell.textContent = `Round ${roundIndex + 1}`;
            row.appendChild(roundCell);
            visibleColumns.forEach((name, columnIndex) => {
                let matchIndex;
                let opponent;
                let boardIndex = 0;
                let match;
                if (teamMode) {
                    matchIndex = findMatch(round, selector.value);
                    match = matchIndex === -1 ? null : round.matches[matchIndex];
                    if (match) {
                        const opponentTeamName = match.a === selector.value ? match.b : match.a;
                        const opposingTeam = competitors().find(team => team.name === opponentTeamName);
                        opponent = opposingTeam?.members[columnIndex];
                        opponent = typeof opponent === 'string' ? opponent : opponent?.name;
                        boardIndex = columnIndex;
                    }
                } else {
                    matchIndex = findMatch(round, name);
                    match = matchIndex === -1 ? null : round.matches[matchIndex];
                    opponent = match ? (match.a === name ? match.b : match.a) : null;
                }
                if (match && opponent) {
                    row.appendChild(createOutcomeCell(state, roundIndex, matchIndex, boardIndex, name, match, opponent));
                } else {
                    const emptyCell = document.createElement('td');
                    if (!teamMode && round.bye === name) emptyCell.textContent = 'Bye';
                    row.appendChild(emptyCell);
                }
            });
            body.appendChild(row);
        });
    }

    if (page === 'leaderboard') renderLeaderboardActions();
    if (page === 'pairing') renderPairingPage();
    if (page === 'scores') renderScorePage();
})();
