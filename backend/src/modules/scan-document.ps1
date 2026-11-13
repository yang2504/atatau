param([Parameter(Mandatory = $true)][string]$OutputPath)

$ErrorActionPreference = 'Stop'
$manager = New-Object -ComObject WIA.DeviceManager
$scanners = @($manager.DeviceInfos | Where-Object { $_.Type -eq 1 })
if ($scanners.Count -eq 0) { exit 2 }
$hp = @($scanners | Where-Object { $_.Properties.Item('Name').Value -match 'Smart Tank.*58' })
if ($hp.Count -eq 1) {
    $scanner = $hp[0]
} elseif ($scanners.Count -eq 1) {
    $scanner = $scanners[0]
} else { exit 3 }

$device = $scanner.Connect()
$item = $device.Items.Item(1)
$jpeg = '{B96B3CAE-0728-11D3-9D7B-0000F81EF32E}'
$image = $item.Transfer($jpeg)
if ($image.FormatID -ne $jpeg) {
    $convert = New-Object -ComObject WIA.ImageProcess
    $convert.Filters.Add($convert.FilterInfos.Item('Convert').FilterID)
    $convert.Filters.Item(1).Properties.Item('FormatID').Value = $jpeg
    $image = $convert.Apply($image)
}
$image.SaveFile($OutputPath)
