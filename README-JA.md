# beatoraja Chart Manager

beatoraja Chart Manager は、beatoraja に入っている段位表・難易度表と、自分の所持譜面、クリア状況をまとめて確認できる Windows 向けアプリです。

![beatoraja Chart Manager の画面例](assets/sample.png)

## ダウンロード

最新版は [Releases ページ](https://github.com/souki202/oraja-bms-manager/releases) からダウンロードできます。

## 主な機能

- beatoraja の table フォルダに入っている難易度表を一覧表示
- 各表に含まれる譜面の所持状況を表示
- NO SONG、NO PLAY、FAILED、CLEAR、HARD CLEAR、FULL COMBO などのクリア状況を表示
- 曲名、アーティスト、ハッシュ、表名、フォルダ名などで検索
- レベル、ノーツ数、クリア状況、URL の有無などで絞り込み
- BMS フォルダ単位で、手元にある譜面を一覧表示
- 譜面の配布 URL、IR ページ、保存先フォルダを右クリックメニューから開く
- 同じ曲や差分らしい譜面を探す Same Song Search
- 重複譜面を検索し、重複しているフォルダをまとめる Duplicate Charts
- BMS 譜面ファイルをドラッグ＆ドロップして差分譜面を取り込み
- BMS フォルダ内の WAV ファイルを OGG ファイルへ変換
- 同じフォルダに MP4 と旧形式 BGA（MPG、MPEG、WMV など）がある場合、旧形式 BGA を削除
- 選択中の表を header.json / data.json として書き出し

## 配布版の起動

配布 zip を展開し、`beatoraja Chart Manager.exe` を実行してください。

初回起動時に beatoraja の場所が自動で見つからない場合は、画面上部の `Select beatoraja` から手動で選択してください。

## ライセンス

このソフトウェアは GPL-3.0 ライセンスで公開されています。
