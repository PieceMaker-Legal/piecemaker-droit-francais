!macro preInit
  Push $0
  Push $1
  CreateDirectory "$LOCALAPPDATA\${PRODUCT_NAME}"
  System::Call 'kernel32::GetTickCount64() l.r0'
  FileOpen $1 "$LOCALAPPDATA\${PRODUCT_NAME}\update-timings.log" a
  FileSeek $1 0 END
  FileWrite $1 "${VERSION} setup-start $0$\r$\n"
  FileClose $1
  Pop $1
  Pop $0
!macroend

!macro customInstall
  Push $0
  Push $1
  System::Call 'kernel32::GetTickCount64() l.r0'
  FileOpen $1 "$LOCALAPPDATA\${PRODUCT_NAME}\update-timings.log" a
  FileSeek $1 0 END
  FileWrite $1 "${VERSION} application-files-ready $0$\r$\n"
  FileClose $1
  Pop $1
  Pop $0
!macroend
