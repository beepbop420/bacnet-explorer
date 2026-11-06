"""
The local AI as a process of its own, started by server.py when it is needed
and closed again when idle, so a model of several gigabytes never sits in the
same process as the BACnet stack. One JSON line in, one JSON line out, on
stdin and stdout. It ends by itself when the server goes away.

usage: nabe_ki_arbeider.py <ki-folder> <model file>
"""
import json
import os
import re
import sys
import time

mappe, modell = sys.argv[1], sys.argv[2]
sys.path.insert(0, os.path.join(mappe, "pakker"))
sys.stdin.reconfigure(encoding="utf-8")
ut = sys.stdout
# The engine talks on stdout when it loads; that line belongs to the protocol.
sys.stdout = sys.stderr
from llama_cpp import Llama  # noqa: E402

REGEL = {
    "nb": "Du er NABE, en hjelper for SD-teknikere. Svar kort på norsk bokmål. Bruk bare teksten i KILDE. "
          "Står svaret ikke der, si at kilden ikke sier det. Legg aldri til tall eller navn som ikke står i KILDE. /no_think",
    "en": "You are NABE, a helper for building automation technicians. Answer briefly in English. Use only the text in SOURCE. "
          "If the answer is not there, say the source does not say. Never add numbers or names that are not in SOURCE. /no_think",
}

m = Llama(modell, n_ctx=2048, n_threads=max(2, min(8, (os.cpu_count() or 4) // 2)), verbose=False)
ut.write(json.dumps({"klar": True}) + "\n")
ut.flush()

for linje in sys.stdin:
    try:
        o = json.loads(linje)
        sprak = "en" if o.get("sprak") == "en" else "nb"
        hode = ("KILDE", "SPØRSMÅL") if sprak == "nb" else ("SOURCE", "QUESTION")
        bruker = f"{hode[0]}:\n" + "\n\n".join(o["kilder"]) + f"\n\n{hode[1]}: {o['sporsmal']}"
        t0 = time.time()
        r = m.create_chat_completion([{"role": "system", "content": REGEL[sprak]}, {"role": "user", "content": bruker}],
                                     max_tokens=int(o.get("maks", 220)), temperature=.2)
        tekst = re.sub(r"<think>.*?</think>", "", r["choices"][0]["message"]["content"], flags=re.S).strip()
        tid = max(time.time() - t0, .01)
        ut.write(json.dumps({"tekst": tekst, "tok_s": round(r["usage"]["completion_tokens"] / tid, 1)}) + "\n")
    except Exception as e:
        ut.write(json.dumps({"feil": str(e)}) + "\n")
    ut.flush()
