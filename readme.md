
# DEV COMMANDS

Backend API
uvicorn api.main:app --host 0.0.0.0 --port 8000 --reload 

Sistema di code di elaborazione delle telecamere
python -m engine.main --config config/site.yaml

Frontend
npm run dev


Utilities:
python zone_editor.py --video ../video-test/cucina-hd.m4v --camera ../config/cameras/cam_kitchen_01.yaml
python scripts/purge_day.py 2026-05-26