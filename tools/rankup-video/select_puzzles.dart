// CLI tool: stdout printing is intentional.
// ignore_for_file: avoid_print

import 'dart:convert';
import 'dart:io' as io;

import 'package:dartchess/dartchess.dart';

/// Lists candidate puzzles for the YouTube narration video with the solver's
/// side, every move in SAN and in spoken English, and the database id (the
/// bundled JSON is inserted in order, so id = index + 1).
///
///   dart run tool/video/select_puzzles.dart [--theme mateIn2] [--tier beginner]
///       [--plies 4] [--min 600] [--max 1000] [--limit 8] [--id 0009B]
void main(List<String> args) {
  String? opt(String name) {
    final i = args.indexOf('--$name');
    return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
  }

  final theme = opt('theme');
  final tier = opt('tier');
  final plies = int.tryParse(opt('plies') ?? '');
  final minR = int.tryParse(opt('min') ?? '') ?? 0;
  final maxR = int.tryParse(opt('max') ?? '') ?? 9999;
  final limit = int.tryParse(opt('limit') ?? '') ?? 8;
  final onlyId = opt('id');

  final raw =
      jsonDecode(io.File('assets/database/puzzles.json').readAsStringSync())
          as List<dynamic>;

  var shown = 0;
  for (var i = 0; i < raw.length && shown < limit; i++) {
    final p = raw[i] as Map<String, dynamic>;
    final themes = (p['themes'] as List<dynamic>).cast<String>();
    final moves = (p['solutionMoves'] as String).split(' ');
    final rating = p['rating'] as int;
    if (onlyId != null && p['lichessId'] != onlyId) continue;
    if (onlyId == null) {
      if (theme != null && !themes.contains(theme)) continue;
      if (tier != null && p['tier'] != tier) continue;
      if (plies != null && moves.length != plies) continue;
      if (rating < minR || rating > maxR) continue;
    }

    final described = describe(p['fen'] as String, moves);
    if (described == null) continue;
    shown++;
    print(
      jsonEncode({
        'dbId': i + 1,
        'lichessId': p['lichessId'],
        'rating': rating,
        'tier': p['tier'],
        'themes': themes,
        'fen': p['fen'],
        'uci': moves,
        ...described,
      }),
    );
  }
}

Map<String, dynamic>? describe(String fen, List<String> uci) {
  Position pos;
  try {
    pos = Chess.fromSetup(Setup.parseFen(fen));
  } catch (_) {
    return null;
  }
  final solver = pos.turn == Side.white ? 'black' : 'white';
  final san = <String>[];
  final spoken = <String>[];
  final fens = <String>[fen];
  for (final m in uci) {
    final move = Move.parse(m);
    if (move == null || !pos.isLegal(move)) return null;
    final (next, s) = pos.makeSan(move);
    san.add(s);
    spoken.add(speak(s, pos, move));
    pos = next;
    fens.add(pos.fen);
  }
  return {
    'solver': solver,
    'setupMove': san.first,
    'san': san,
    'spoken': spoken,
    'fens': fens,
    'endsInMate': pos.isCheckmate,
  };
}

const _pieceNames = {
  'K': 'king',
  'Q': 'queen',
  'R': 'rook',
  'B': 'bishop',
  'N': 'knight',
};

/// Turns SAN like "Nxe6+" into "knight takes on e6, check".
String speak(String san, Position before, Move move) {
  if (san.startsWith('O-O-O')) return 'castles long';
  if (san.startsWith('O-O')) return 'castles short';
  var s = san;
  var suffix = '';
  if (s.endsWith('#')) {
    suffix = ', checkmate';
    s = s.substring(0, s.length - 1);
  } else if (s.endsWith('+')) {
    suffix = ', check';
    s = s.substring(0, s.length - 1);
  }
  String? promo;
  final eq = s.indexOf('=');
  if (eq >= 0) {
    promo = _pieceNames[s[eq + 1]];
    s = s.substring(0, eq);
  }
  final capture = s.contains('x');
  final dest = s.substring(s.length - 2);
  final piece = _pieceNames[s[0]];
  final buf = StringBuffer();
  if (piece == null) {
    // Pawn move.
    buf.write(capture ? 'pawn takes on $dest' : 'pawn to $dest');
  } else {
    // Disambiguation like "Nbd2" or "R1e1".
    final body = s.substring(1).replaceAll('x', '');
    final from = body.length > 2 ? body.substring(0, body.length - 2) : '';
    final origin = from.isEmpty ? '' : ' from $from';
    buf.write(
      capture ? '$piece$origin takes on $dest' : '$piece$origin to $dest',
    );
  }
  if (promo != null) buf.write(', promoting to a $promo');
  buf.write(suffix);
  return buf.toString();
}
