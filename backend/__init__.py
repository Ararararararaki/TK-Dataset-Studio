"""Independent dataset annotation services."""
import os, sys
from pathlib import Path
_dll=None
if os.name=='nt' and hasattr(os,'add_dll_directory'):
    _path=Path(sys.executable).parent/'Lib/site-packages-cp312/pywin32_system32'
    if _path.is_dir():_dll=os.add_dll_directory(str(_path))
