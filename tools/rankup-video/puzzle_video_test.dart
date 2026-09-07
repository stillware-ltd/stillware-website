import 'dart:convert';
import 'dart:io';

import 'package:flame/game.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:path_provider/path_provider.dart';
import 'package:rankup_chess/core/navigation/app_router.dart';
import 'package:rankup_chess/data/local_db.dart';
import 'package:rankup_chess/data/repositories/puzzle_repository.dart';
import 'package:rankup_chess/data/repositories/user_repository.dart';
import 'package:rankup_chess/features/board/chess_game.dart';
import 'package:rankup_chess/features/monetization/config/purchase_config.dart';
import 'package:rankup_chess/main.dart' as app;
import 'package:shared_preferences/shared_preferences.dart';

/// Drives one library puzzle on a fixed schedule while the host records the
/// simulator screen — the YouTube puzzle videos are cut from these captures.
///
/// The schedule arrives base64-encoded in `--dart-define=PLAN_B64=`:
///
/// ```json
/// {
///   "puzzleId": 136,          // database id (see tool/video/select_puzzles.dart)
///   "flipped": false,         // true when the solver plays Black
///   "introHold": 4.0,         // seconds on the home screen before the puzzle
///   "moves": [{"uci": "e4f6", "at": 12.4}],  // solver drags, seconds after t0
///   "outroHold": 8.0          // seconds to keep rolling after the last drag
/// }
/// ```
///
/// Sync protocol with `tool/video/record_puzzle.sh`: the test prints
/// `REC_START`, the host starts `simctl io recordVideo`, then touches
/// `<Documents>/rec_go`; the test polls for that file and sets t0 when it
/// appears, so every `at` is measured from a moment that is already on tape.
///
/// `flutter drive` reinstalls the app into a fresh container, so the test
/// seeds its own state: the hidden developer premium override (library
/// puzzles are gated; the override only labels the settings screen, which is
/// never on camera) and a "Champ" profile for the home screen greeting.
void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  /// Advances frames for a fixed span. Not pumpAndSettle: several screens
  /// animate forever and it would never return.
  Future<void> settleFor(WidgetTester tester, Duration total) async {
    const step = Duration(milliseconds: 100);
    for (var elapsed = Duration.zero; elapsed < total; elapsed += step) {
      await tester.pump(step);
    }
  }

  testWidgets('record a narrated puzzle', (tester) async {
    const planB64 = String.fromEnvironment('PLAN_B64');
    expect(planB64, isNotEmpty, reason: 'pass --dart-define=PLAN_B64=');
    final plan =
        jsonDecode(utf8.decode(base64Decode(planB64))) as Map<String, dynamic>;
    final puzzleId = plan['puzzleId'] as int;
    final flipped = plan['flipped'] as bool;
    final introHold = (plan['introHold'] as num).toDouble();
    final outroHold = (plan['outroHold'] as num).toDouble();
    final moves = (plan['moves'] as List<dynamic>).cast<Map<String, dynamic>>();

    // Premium must be known before the purchase provider initialises.
    final prefs = await SharedPreferences.getInstance();
    await prefs.setBool(PurchaseConfig.devModeKey, true);

    app.main();
    await settleFor(tester, const Duration(seconds: 6));

    final users = UserRepository(LocalDb.instance);
    var profile = await users.getActiveProfile();
    if (profile == null) {
      profile = await users.createProfile(
        username: 'Champ',
        avatarId: 'knight_blue',
      );
      await users.setActiveProfile(profile.id);
    }
    // First launch imports the 5,000 puzzles; wait for ours to exist.
    final puzzles = PuzzleRepository(LocalDb.instance);
    final importDeadline = DateTime.now().add(const Duration(seconds: 60));
    while (await puzzles.getPuzzle(puzzleId) == null &&
        DateTime.now().isBefore(importDeadline)) {
      await tester.pump(const Duration(milliseconds: 250));
    }
    debugPrint('SEEDED profile=${profile.id}');

    appRouter.go('/home');
    await settleFor(tester, const Duration(seconds: 3));

    debugPrint('REC_START');
    final docs = await getApplicationDocumentsDirectory();
    final marker = File('${docs.path}/rec_go');
    final deadline = DateTime.now().add(const Duration(seconds: 90));
    while (!marker.existsSync() && DateTime.now().isBefore(deadline)) {
      await tester.pump(const Duration(milliseconds: 50));
    }
    if (marker.existsSync()) marker.deleteSync();
    final clock = Stopwatch()..start();
    debugPrint('T0');

    Future<void> waitUntil(double seconds) async {
      while (clock.elapsedMilliseconds < seconds * 1000) {
        await tester.pump(const Duration(milliseconds: 30));
      }
    }

    await waitUntil(introHold);
    appRouter.go('/curriculum/puzzle/$puzzleId');
    debugPrint('GO_PUZZLE ${clock.elapsedMilliseconds}');

    for (final m in moves) {
      await waitUntil((m['at'] as num).toDouble());
      await _dragMove(tester, m['uci'] as String, flipped: flipped);
      debugPrint('MOVE ${m['uci']} ${clock.elapsedMilliseconds}');
    }

    final lastAt = moves.isEmpty ? introHold : (moves.last['at'] as num);
    await waitUntil(lastAt.toDouble() + outroHold);
    debugPrint('REC_END ${clock.elapsedMilliseconds}');
  });
}

/// Drags the piece on the board from the UCI origin square to its target.
Future<void> _dragMove(
  WidgetTester tester,
  String uci, {
  required bool flipped,
}) async {
  final finder = find.byType(GameWidget<ChessGame>);
  expect(finder, findsOneWidget, reason: 'puzzle board not on screen');
  final box = tester.renderObject(finder) as RenderBox;
  final origin = box.localToGlobal(Offset.zero);
  final square = box.size.width / 8;

  Offset center(String sq) {
    final file = sq.codeUnitAt(0) - 'a'.codeUnitAt(0);
    final rank = int.parse(sq[1]);
    final col = flipped ? 7 - file : file;
    final row = flipped ? rank - 1 : 8 - rank;
    return origin + Offset((col + 0.5) * square, (row + 0.5) * square);
  }

  final from = center(uci.substring(0, 2));
  final to = center(uci.substring(2, 4));
  await tester.timedDragFrom(
    from,
    to - from,
    const Duration(milliseconds: 450),
  );
  await tester.pump(const Duration(milliseconds: 100));
}
