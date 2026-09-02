' Starter BACnet Explorer uten synlig vindu, til bruk ved paalogging.
' start.bat brukes fortsatt naar du vil se hva som skjer - denne er kun for
' autostart, der et konsollvindu som staar aapent hele dagen bare er i veien.
'
' Bevisst python.exe med skjult vindu, ikke pythonw.exe: pythonw har ingen
' stdout, og uvicorns logging doer stille mot en lukket strom - serveren
' startet da rett og slett ikke, uten en feilmelding noe sted. Med python.exe
' finnes stroemmen, den gaar til autostart.log, og vinduet er skjult.
Option Explicit

Dim skall, fso, mappe, exe, kommando

Set skall = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
mappe = fso.GetParentFolderName(WScript.ScriptFullName)
exe = mappe & "\venv\Scripts\python.exe"

' Uten venv gaar det ikke - da maa start.bat kjoeres en gang foerst.
If Not fso.FileExists(exe) Then
  MsgBox "Foerste gangs oppsett mangler." & vbCrLf & vbCrLf & _
         "Kjoer start.bat en gang foerst - det tar et par minutter.", _
         vbExclamation, "BACnet Explorer"
  WScript.Quit 1
End If

' Skal notater deles med en felles instans, settes NOTES_UPSTREAM her - via
' cmd, ikke via WScript.Shell.Environment: tilordning til PROCESS-omraadet
' feiler og avbryter skriptet foer serveren rekker aa starte.
'   kommando = "cmd /c cd /d ... && set NOTES_UPSTREAM=http://vert:8090 && ..."
kommando = "cmd /c cd /d """ & mappe & """ && " & _
           """" & exe & """ -m uvicorn server:app --host 127.0.0.1 --port 8090" & _
           " > autostart.log 2>&1"

On Error Resume Next
' 0 = skjult vindu, False = ikke vent paa at den avslutter
skall.Run kommando, 0, False
If Err.Number <> 0 Then
  MsgBox "Klarte ikke starte BACnet Explorer." & vbCrLf & vbCrLf & _
         "Feil " & Err.Number & ": " & Err.Description & vbCrLf & vbCrLf & _
         "Proev aa kjoere start.bat i stedet.", vbCritical, "BACnet Explorer"
  WScript.Quit 1
End If
