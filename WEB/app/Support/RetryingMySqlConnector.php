<?php
namespace App\Support;
use Illuminate\Database\Connectors\MySqlConnector;
use PDOException;

class RetryingMySqlConnector extends MySqlConnector
{
    public function connect(array $config)
    {
        for ($attempt = 0; ; $attempt++) {
            try { return $this->connectOnce($config); }
            catch (PDOException $exception) {
                if ($attempt >= 2 || (int) ($exception->errorInfo[1] ?? 0) !== 2002 || ! str_contains(strtolower($exception->getMessage()), 'operation not permitted')) throw $exception;
                usleep(150000 * ($attempt + 1));
            }
        }
    }
    protected function connectOnce(array $config) { return parent::connect($config); }
}
